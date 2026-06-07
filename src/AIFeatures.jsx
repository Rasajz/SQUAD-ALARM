import { useState } from "react";
import { askGemini, getAlarmAdvice, generateAlarmMessage } from "./geminiAgent";
import { askPerplexity, getLocationBasedAlerts } from "./perplexityAgent";
import "./AIFeatures.css";

export function AIFeatures({ groupName, userName }) {
  const [aiResponse, setAiResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("gemini");

  const handleGeminiAdvice = async () => {
    setLoading(true);
    try {
      const advice = await getAlarmAdvice("group emergency response");
      setAiResponse(advice);
    } catch (err) {
      setAiResponse("❌ Error: " + err.message);
    }
    setLoading(false);
  };

  const handleGenerateMessage = async () => {
    setLoading(true);
    try {
      const message = await generateAlarmMessage(groupName, userName);
      setAiResponse(message);
    } catch (err) {
      setAiResponse("❌ Error: " + err.message);
    }
    setLoading(false);
  };

  const handlePerplexitySearch = async () => {
    setLoading(true);
    try {
      const info = await askPerplexity("What are emergency protocols for teams?");
      setAiResponse(info);
    } catch (err) {
      setAiResponse("❌ Error: " + err.message);
    }
    setLoading(false);
  };

  const handleLocationAlerts = async () => {
    setLoading(true);
    try {
      const alerts = await getLocationBasedAlerts("current location");
      setAiResponse(alerts);
    } catch (err) {
      setAiResponse("❌ Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="ai-features">
      <div className="ai-tabs">
        <button
          className={`ai-tab ${activeTab === "gemini" ? "active" : ""}`}
          onClick={() => setActiveTab("gemini")}
        >
          🤖 Gemini Pro
        </button>
        <button
          className={`ai-tab ${activeTab === "perplexity" ? "active" : ""}`}
          onClick={() => setActiveTab("perplexity")}
        >
          🔍 Perplexity Pro
        </button>
      </div>

      <div className="ai-content">
        {activeTab === "gemini" && (
          <div className="ai-section">
            <h3>🤖 Gemini AI Assistant</h3>
            <p>Get AI-powered advice and message generation</p>
            <div className="ai-buttons">
              <button onClick={handleGeminiAdvice} disabled={loading}>
                {loading ? "⏳ Loading..." : "📋 Get Advice"}
              </button>
              <button onClick={handleGenerateMessage} disabled={loading}>
                {loading ? "⏳ Loading..." : "✍️ Generate Message"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "perplexity" && (
          <div className="ai-section">
            <h3>🔍 Perplexity Research</h3>
            <p>Search real-time information</p>
            <div className="ai-buttons">
              <button onClick={handlePerplexitySearch} disabled={loading}>
                {loading ? "⏳ Loading..." : "🔎 Emergency Protocols"}
              </button>
              <button onClick={handleLocationAlerts} disabled={loading}>
                {loading ? "⏳ Loading..." : "📍 Location Alerts"}
              </button>
            </div>
          </div>
        )}

        {aiResponse && (
          <div className="ai-response">
            <h4>AI Response:</h4>
            <p>{aiResponse}</p>
          </div>
        )}
      </div>
    </div>
  );
}
