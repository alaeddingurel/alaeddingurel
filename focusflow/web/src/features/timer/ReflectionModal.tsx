import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Modal, Stars } from "../../components/ui";
import { useTimer } from "../../state/timer";

const FOCUS_WORDS = ["", "Scattered", "Distracted", "Okay", "Focused", "In the zone"];
const ENERGY_WORDS = ["", "Drained", "Low", "Steady", "Good", "Energized"];

/** Quick post-session reflection. Ratings power peak-hour detection and the adaptive timer. */
export function ReflectionModal() {
  const { review, closeReview } = useTimer();
  const [focus, setFocus] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => { setFocus(null); setEnergy(null); setNote(""); }, [review]);

  async function save() {
    if (review?.sessionId && (focus || energy || note)) {
      await api.rateSession(review.sessionId, { focusRating: focus, energy, note: note || undefined }).catch(() => {});
    }
    closeReview();
  }

  return (
    <Modal open={!!review} onClose={closeReview} title={review?.completed ? `${review.minutes} minutes done 🎉` : "Session ended early"}>
      <p className="muted">Three seconds of reflection makes your coach much smarter.</p>
      <div className="reflect-row">
        <span>How focused were you?</span>
        <Stars value={focus} onChange={setFocus} label="Focus rating" />
        <span className="reflect-word">{focus ? FOCUS_WORDS[focus] : ""}</span>
      </div>
      <div className="reflect-row">
        <span>Energy level?</span>
        <Stars value={energy} onChange={setEnergy} label="Energy rating" />
        <span className="reflect-word">{energy ? ENERGY_WORDS[energy] : ""}</span>
      </div>
      <label className="field">
        <span>Note <small className="muted">(optional)</small></span>
        <input value={note} maxLength={300} placeholder={review?.completed ? "What did you get done?" : "What pulled you away?"}
          onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
      </label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={closeReview}>Skip</button>
        <button className="btn primary" onClick={() => void save()}>Save</button>
      </div>
      {!review?.sessionId && <p className="hint">You're offline — the session is queued, but this rating won't be saved.</p>}
    </Modal>
  );
}
