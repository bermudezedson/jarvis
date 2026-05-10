const Anthropic = require('@anthropic-ai/sdk');
const logger = require('./logger');

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

async function classifyEmail(subject, snippet, fromDomain) {
  const ai = getClient();
  if (!ai) {
    logger.warn('ANTHROPIC_API_KEY not set — skipping AI classification', { skill: 'ai-classifier' });
    return { needs_decision: snippet.length > 50, severity: 'medium', category: 'unknown' };
  }

  const message = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Classify this business email for a B2B SaaS CEO. Reply with JSON only.
Subject: ${subject}
From domain: ${fromDomain}
Snippet: ${snippet}

JSON format: {"needs_decision": bool, "severity": "high|medium|low", "category": "client|billing|technical|internal|spam"}`
    }],
  });

  try {
    return JSON.parse(message.content[0].text);
  } catch {
    return { needs_decision: true, severity: 'medium', category: 'unknown' };
  }
}

module.exports = { classifyEmail };
