"use client";

import { useEffect } from "react";

import { useRealtimeVoice } from "@/app/lib/realtime/useRealtimeVoice";

const statusCopy = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  speaking: "Speaking",
  saving: "Saving to Notion",
  reconnecting: "Reconnecting",
  error: "Needs attention",
};

export function VoiceInbox() {
  const {
    status,
    error,
    transcript,
    recentItems,
    isActive,
    start,
    stop,
    reconnect,
    refreshRecentItems,
  } = useRealtimeVoice();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }

    void refreshRecentItems();
  }, [refreshRecentItems]);

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <div>
          <p className="eyebrow">Voice Action App</p>
          <h1 id="app-title">Think out loud. Keep the useful parts.</h1>
        </div>

        <div className={`status status-${status}`} role="status">
          <span aria-hidden="true" />
          {statusCopy[status]}
        </div>
      </section>

      <section className="mic-panel" aria-label="Voice controls">
        <button
          className={`mic-button ${isActive ? "mic-button-active" : ""}`}
          onClick={isActive ? stop : start}
          type="button"
          aria-label={isActive ? "Stop conversation" : "Start conversation"}
        >
          <span className="mic-icon" aria-hidden="true" />
          <span>{isActive ? "Stop" : "Start conversation"}</span>
        </button>

        {error ? (
          <div className="error-box">
            <p>{error}</p>
            <button type="button" onClick={reconnect}>
              Reconnect
            </button>
          </div>
        ) : null}
      </section>

      <section className="content-grid">
        <div className="panel transcript-panel">
          <div className="panel-header">
            <h2>Transcript</h2>
          </div>
          <div className="transcript-list" aria-live="polite">
            {transcript.length ? (
              transcript.map((entry) => (
                <article className={`line line-${entry.role}`} key={entry.id}>
                  <div>
                    <span>{entry.role}</span>
                    <time>{entry.at}</time>
                  </div>
                  <p>{entry.text}</p>
                </article>
              ))
            ) : (
              <p className="empty">Start a conversation and speak naturally.</p>
            )}
          </div>
        </div>

        <div className="panel saved-panel">
          <div className="panel-header">
            <h2>Recent saved</h2>
            <button type="button" onClick={refreshRecentItems}>
              Refresh
            </button>
          </div>
          <div className="saved-list">
            {recentItems.length ? (
              recentItems.map((item) => (
                <article className="saved-item" key={item.id}>
                  <div>
                    <h3>{item.title}</h3>
                    {item.priority ? <span>{item.priority}</span> : null}
                  </div>
                  {item.summary ? <p>{item.summary}</p> : null}
                  {item.tags?.length ? (
                    <ul>
                      {item.tags.slice(0, 4).map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="empty">Saved Notion notes will appear here.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
