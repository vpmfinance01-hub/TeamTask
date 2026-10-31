import { Link } from "react-router-dom";
import type { Occurrence } from "../lib/types";
import { Chip, isLate } from "./ui";
import { niceDate, niceDateTime } from "../lib/util";
import { t } from "../lib/i18n";

export default function OccCard({
  o,
  showWho,
  showDate,
}: {
  o: Occurrence;
  showWho?: boolean;
  showDate?: boolean;
}) {
  const late = isLate(o);
  const tick = o.status === "approved" ? "✓" : o.status === "submitted" ? "…" : o.status === "rejected" ? "!" : "";
  return (
    <Link to={`/o/${o.id}`} className={`task st-${late ? "late" : o.status} ${o.tasks.priority ? "high" : ""}`}>
      <span className={`tick ${o.status}`}>{tick}</span>
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="title">
          {o.tasks.title}
          {o.tasks.priority ? <span className="urgent">{t("спешно")}</span> : null}
        </div>
        <div className="row wrap small muted" style={{ gap: 8 }}>
          {o.groups && (
            <span className="row" style={{ gap: 5 }}>
              <i className="dot" style={{ background: o.groups.color }} />
              {o.groups.name}
            </span>
          )}
          {o.tasks.due_time && <span>{t("до {time}", { time: o.tasks.due_time.slice(0, 5) })}</span>}
          {showDate && <span>{niceDate(o.due_date)}</span>}
          {showWho && (o.completer?.display_name ?? o.assignee?.display_name) && (
            <span>👤 {o.completer?.display_name ?? o.assignee?.display_name}</span>
          )}
          {o.completed_at && showWho && <span>{niceDateTime(o.completed_at)}</span>}
        </div>
        {o.status === "rejected" && o.review_comment && (
          <div className="small" style={{ color: "var(--bad)" }}>
            {t("Върнато")}: {o.review_comment}
          </div>
        )}
      </div>
      <Chip status={o.status} late={late} />
    </Link>
  );
}
