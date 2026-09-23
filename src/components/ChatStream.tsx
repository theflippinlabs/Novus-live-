import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AnalyzedComment } from "../../shared/types";
import { useT } from "../i18n";
import { clock } from "../format";
import { openViewer, useStore } from "../store";
import { Avatar, SeverityBadge } from "./ui";

// Virtualized chat: only visible rows are in the DOM; rows are memoized on the
// comment object, so a batch of new messages renders only the new rows.

const ChatRow = memo(function ChatRow({ c, host }: { c: AnalyzedComment; host: boolean }) {
  const a = c.analysis;
  const flagged = a.severity !== "normal";
  return (
    <div className={`msg ${a.severity}`} onClick={() => openViewer(c.viewer.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openViewer(c.viewer.id)}>
      <Avatar viewer={c.viewer} />
      <div className="msg-body">
        <div className="msg-head">
          <span className={`msg-user ${host ? "host" : ""}`}>@{c.viewer.username}</span>
          {flagged ? <SeverityBadge severity={a.severity} score={a.riskScore} /> : null}
          {a.stage === "ai" ? <span className="ai-tag">AI</span> : a.aiPending ? <span className="ai-tag muted">AI…</span> : null}
          <span className="msg-time">{clock(c.timestamp)}</span>
        </div>
        <div className="msg-text">{c.text}</div>
        {flagged && a.reasons.length ? (
          <div className="msg-reasons">
            {a.reasons.slice(0, 3).map((r) => (
              <span key={r} className="reason">
                {r}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export function ChatStream({ flaggedOnly }: { flaggedOnly: boolean }) {
  const t = useT();
  const all = useStore((s) => s.comments);
  const streamer = useStore((s) => s.settings.streamerName.toLowerCase());
  const comments = useMemo(() => (flaggedOnly ? all.filter((c) => c.analysis.severity !== "normal") : all), [all, flaggedOnly]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unread, setUnread] = useState(0);
  const lastCount = useRef(comments.length);

  const virtualizer = useVirtualizer({
    count: comments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 10,
    getItemKey: (i) => comments[i].id,
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setUnread(0);
  }, []);

  useLayoutEffect(() => {
    const added = comments.length - lastCount.current;
    lastCount.current = comments.length;
    if (!comments.length) return;
    if (atBottom.current) virtualizer.scrollToIndex(comments.length - 1, { align: "end" });
    else if (added > 0) setUnread((u) => u + added);
  }, [comments, virtualizer]);

  useEffect(() => {
    atBottom.current = true;
    setUnread(0);
  }, [flaggedOnly]);

  const jump = () => {
    atBottom.current = true;
    setUnread(0);
    virtualizer.scrollToIndex(comments.length - 1, { align: "end" });
  };

  return (
    <div className="chat-wrap">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll} aria-live="off" aria-label="Live chat">
        {comments.length === 0 ? <div className="empty">{t("emptyChat")}</div> : null}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const c = comments[item.index];
            return (
              <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}>
                <ChatRow c={c} host={c.viewer.username.toLowerCase() === streamer} />
              </div>
            );
          })}
        </div>
      </div>
      {unread > 0 ? (
        <button className="new-pill" onClick={jump}>
          ↓ {unread > 999 ? "999+" : unread} {t("newMessages")}
        </button>
      ) : null}
    </div>
  );
}
