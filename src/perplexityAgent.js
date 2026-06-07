import axios from "axios";

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export async function askPerplexity(question) {
  try {
    const response = await axios.post(
      PERPLEXITY_API_URL,
      {
        model: "pplx-7b-online",
        messages: [
          {
            role: "user",
            content: question,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Perplexity error:", error);
    throw new Error("Failed to get Perplexity response");
  }
}

export async function searchForEmergencyInfo(topic) {
  const prompt = `Search for current information about: ${topic}. Provide 2-3 key facts.`;
  return askPerplexity(prompt);
}

export async function getLocationBasedAlerts(location) {
  const prompt = `What are current emergency alerts or weather warnings for ${location}?`;
  return askPerplexity(prompt);
}
