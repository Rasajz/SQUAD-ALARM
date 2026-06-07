import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

export async function askGemini(question) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(question);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini error:", error);
    throw new Error("Failed to get Gemini response");
  }
}

export async function getAlarmAdvice(situation) {
  const prompt = `As an emergency response advisor, give quick advice for: ${situation}. Keep it to 2-3 sentences.`;
  return askGemini(prompt);
}

export async function generateAlarmMessage(groupName, userName) {
  const prompt = `Generate a short, urgent alarm notification message for a group called "${groupName}" triggered by ${userName}. Make it catchy and clear.`;
  return askGemini(prompt);
}
