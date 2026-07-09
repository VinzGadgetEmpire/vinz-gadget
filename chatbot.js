/* Simple FAQ chatbot — no API, no key, no server call.
   Matches the customer's message against keyword groups below and returns
   a canned answer. Edit ANSWERS to add/change topics; each entry's
   `keywords` array is checked against the lowercased message. */

const ANSWERS = [
  {
    id: 'warranty',
    keywords: ['warranty', 'guarantee', 'cover', 'coverage', 'broken', 'faulty'],
    reply: "Every pre-owned phone comes with a genuine 100-day warranty — battery health, screen, cameras, and internals are all checked before it's ever listed for sale. New sealed units carry the standard manufacturer warranty.",
  },
  {
    id: 'pricing',
    keywords: ['price', 'pricing', 'cost', 'how much', 'rm', 'cheap', 'expensive'],
    reply: "Pricing is straight — no bargaining games. New and used prices are shown side by side on each model, so head to the New or Pre-Owned sections on the site to see current numbers.",
  },
  {
    id: 'condition',
    keywords: ['condition', 'inspect', 'inspected', 'used', 'pre-owned', 'preowned', 'refurbished', 'grade'],
    reply: "Every pre-owned unit is inspected down to the last screw before it reaches the shelf — battery, screen, cameras, and internals all get checked, and it's backed by a 100-day warranty either way.",
  },
  {
    id: 'tradein',
    keywords: ['trade', 'trade-in', 'tradein', 'sell my', 'swap'],
    reply: "We do look at trade-ins case by case depending on model and condition — best to call 018-765 5733 or book an appointment on the site so we can quote your device properly.",
  },
  {
    id: 'location',
    keywords: ['where', 'location', 'address', 'shop', 'store', 'directions', 'johor', 'jalan'],
    reply: "We're at 20-3-12 Block 20, Jalan 1/108C, Taman Sungai Besi, 57100 Kuala Lumpur. Walk in any time we're open, or call ahead and we'll have things ready for you.",
  },
  {
    id: 'hours',
    keywords: ['hour', 'hours', 'open', 'closing', 'time', 'today'],
    reply: "Opening hours can shift around holidays, so the safest bet is to call 018-765 5733 and confirm we're open before you head over.",
  },
  {
    id: 'contact',
    keywords: ['contact', 'phone number', 'call', 'whatsapp', 'instagram', 'social'],
    reply: "You can call or WhatsApp 018-765 5733, or find us on Instagram @vinz_gadjet.",
  },
  {
    id: 'booking',
    keywords: ['book', 'appointment', 'reserve', 'schedule', 'visit'],
    reply: "You can book an appointment right on the site — scroll to the \"Book Appointment\" section, fill in your details and preferred time, and we'll follow up.",
  },
  {
    id: 'models',
    keywords: ['iphone', 'model', 'which phone', 'storage', 'gb', 'tb'],
    reply: "We carry new sealed iPhones from the 17 series down, plus pre-owned models back to the iPhone 13 series with various storage options — check the New and Pre-Owned sections for the full lineup and specs.",
  },
];

const FALLBACK_REPLY = "I don't have a canned answer for that one — best to call 018-765 5733 or book an appointment and ask the team directly.";

const GREETING = "Hey! I'm the Vinz Gadget Empire FAQ bot. Ask me about warranty, pricing, trade-ins, location, or booking — or tap a quick question below.";

const QUICK_QUESTIONS = [
  'What warranty do pre-owned phones get?',
  'Where are you located?',
  'How do I book an appointment?',
  'Do you take trade-ins?',
];

const logEl = document.getElementById('chat-log');
const quickEl = document.getElementById('chat-quick');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');

function addMessage(text, role) {
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  msg.textContent = text;
  logEl.appendChild(msg);
  logEl.scrollTop = logEl.scrollHeight;
}

function findReply(userText) {
  const lower = userText.toLowerCase();
  for (const entry of ANSWERS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.reply;
    }
  }
  return FALLBACK_REPLY;
}

function handleUserMessage(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  addMessage(trimmed, 'user');
  // tiny delay so it reads like a reply, not an instant lookup
  setTimeout(() => addMessage(findReply(trimmed), 'bot'), 350);
}

function renderQuickQuestions() {
  quickEl.innerHTML = '';
  QUICK_QUESTIONS.forEach((q) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-quick-btn';
    btn.textContent = q;
    btn.addEventListener('click', () => handleUserMessage(q));
    quickEl.appendChild(btn);
  });
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value;
  inputEl.value = '';
  handleUserMessage(text);
});

addMessage(GREETING, 'bot');
renderQuickQuestions();
