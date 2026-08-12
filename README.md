# TaskMind AI - Smart Planner & Personal Productivity Dashboard

A modern, beginner-friendly web application built with **HTML5, CSS3, and JavaScript**. It allows users to define exams, tasks, schedules, daily notes, and goals using natural language. The built-in AI (or your custom **Dify.ai** agent) automatically schedules items onto an interactive calendar, manages your daily to-do lists, tracks achieved goals, and records daily self-reflections.

---

## 📁 Clean File Structure

```
c:/Users/Divam Malik/Desktop/Ai/
├── index.html     # Single HTML structure & modal layout
├── style.css      # Single CSS stylesheet with glassmorphic themes
├── script.js     # Single JS file (AI Client, Smart Parser, Calendar, Tasks, Goals, Notes)
├── .env           # Stores your Dify API Key & Base URL securely
├── .gitignore     # Prevents .env from being committed to Git
└── README.md      # Documentation
```

---

## 🔑 How to set your Dify.ai API Key

1. Open **`.env`** file in your code editor.
2. Set your API Key:
   ```env
   DIFY_API_KEY=app-your_dify_api_key_here
   DIFY_BASE_URL=https://api.dify.ai/v1
   ```
3. Save the `.env` file! `script.js` will automatically read your Dify credentials on load.

---

## 🚀 How to Run

No Node.js, npm, or build tools required!

1. Double-click **`index.html`** to open it directly in any modern browser (Chrome, Edge, Firefox, Safari).
2. Type any schedule prompt in the top AI bar (e.g. *"Physics Midterm Exam next Tuesday at 10 AM"*).
