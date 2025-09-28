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
app.set('trust proxy', true); // To get real IP if behind proxy

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
      error: 'You have reached your AI usage limit. Please try again in a few hours.',
    });
  }

  try {
    // ✅ Use the updated Gemini 2.5 model
    const model = genAI.getGenerativeModel({
      model: 'models/gemini-2.5-flash-preview-05-20',
    });

    // ✅ Log the model being used
    console.log("Using AI model:", model.modelId || "unknown");

    const prompt = `
A person wrote this journal entry:

"${journalEntry}"

Please give supportive, kind mental health feedback, suggesting 1–2 helpful coping ideas or reflections.
    `;

    const result = await model.generateContent(prompt);
    let text = await result.response.text();

    // Clean up text (remove ``` if any)
    text = text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(\w*)\n/, '');
      text = text.replace(/```$/, '');
    }

    incrementUsage(ip);

    res.json({ reply: text });
  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: 'Failed to get response from Gemini.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on https://vent2meserver.onrender.com:${PORT}`);
});
