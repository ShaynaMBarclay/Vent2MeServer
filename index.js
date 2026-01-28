import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.set('trust proxy', true); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Track IP usage with timestamp
const usageByIP = {};

function canUseAI(ip) {
  const now = Date.now();
  const sixHours = 6 * 60 * 60 * 1000;

  if (!usageByIP[ip]) {
    usageByIP[ip] = { count: 0, startTime: now };
  }

  const { count, startTime } = usageByIP[ip];

  // Reset if 6 hours passed
  if (now - startTime > sixHours) {
    usageByIP[ip] = { count: 0, startTime: now };
    return true;
  }

  return count < 20;
}

function incrementUsage(ip) {
  usageByIP[ip].count += 1;
}

app.post('/gemini', async (req, res) => {
  const { journalEntry } = req.body;
  const ip = req.ip;

  if (!journalEntry) {
    return res.status(400).json({ error: 'Missing journal entry.' });
  }

  if (!canUseAI(ip)) {
    return res.status(429).json({
      error: 'You have reached your usage limit. Please try again in a few hours.',
    });
  }

  const primaryModel = 'models/gemini-2.5-flash-preview-09-2025';
  const fallbackModel = 'models/gemini-2.5-flash';

  try {
    let model;
    try {
      // Try primary model first
      model = genAI.getGenerativeModel({ model: primaryModel });
      console.log(`🧠 Using primary model: ${primaryModel}`);
    } catch {
      // If fails during initialization, use fallback immediately
      console.warn(`⚠️ Primary model failed to initialize. Switching to fallback: ${fallbackModel}`);
      model = genAI.getGenerativeModel({ model: fallbackModel });
    }

    const prompt = `
A person wrote this journal entry:

"${journalEntry}"

Begin by briefly noting that the guidance you’re offering is not a substitute for medical or professional care. Keep this disclaimer short and gentle.

If the journal entry suggests the person may be at risk of harming themselves or others, respond with care but clarity. Encourage them to contact emergency services or reach out to a trusted professional or support resource immediately, and provide a few appropriate support options.

After this, offer warm, compassionate, and supportive guidance, as a trusted friend or mentor would. Share two to three gentle coping ideas, grounding techniques, or reflective thoughts that feel realistic, kind, and easy to approach.

Maintain a nurturing, reassuring tone throughout. Avoid sounding clinical, instructional, or overwhelming, and do not mention that you are an AI at any point.

    `;

    let result;
    try {
      result = await model.generateContent(prompt);
    } catch (error) {
      console.warn(`⚠️ Error using ${primaryModel}. Retrying with fallback model.`);
      // Retry once with fallback
      const fallback = genAI.getGenerativeModel({ model: fallbackModel });
      result = await fallback.generateContent(prompt);
    }

    let text = await result.response.text();

    text = text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(\w*)\n/, '');
      text = text.replace(/```$/, '');
    }

    incrementUsage(ip);

    res.json({ reply: text });
  } catch (error) {
    console.error('❌ Gemini API Error:', error);
    res.status(500).json({ error: 'Failed to get response from Gemini.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on https://vent2meserver.onrender.com:${PORT}`);
});
