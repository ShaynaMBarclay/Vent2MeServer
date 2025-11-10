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

Please start your response by clearly stating that your advice is **not a replacement for medical or professional help**. 
If anything in the entry seems potentially harmful to themselves or others, instruct them to **call emergency services immediately**.  

After this disclaimer, provide **supportive, kind, and compassionate mental health feedback**, offering 1–2 practical coping ideas or gentle reflections. 
Keep the tone friendly, nurturing, and encouraging, like a trusted friend or mentor would.
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
