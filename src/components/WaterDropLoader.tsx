import { useEffect, useState } from "react";

interface WaterDropLoaderProps {
  /** Message shown below the animation */
  message?: string;
}

/**
 * Full-page water-drop loading overlay.
 * Mount it while data is loading; it fades itself out when unmounted.
 */
export function WaterDropLoader({ message = "Fetching live readings…" }: WaterDropLoaderProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    return () => setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #0c2340 50%, #0f3460 100%)",
        animation: "fadeInLoader 0.3s ease-out",
      }}
    >
      <style>{`
        @keyframes fadeInLoader {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dropBounce {
          0%   { transform: translateY(-18px) scaleY(0.85); opacity: 0; }
          40%  { transform: translateY(0)     scaleY(1.08); opacity: 1; }
          60%  { transform: translateY(-6px)  scaleY(0.96); }
          80%  { transform: translateY(0)     scaleY(1.03); }
          100% { transform: translateY(0)     scaleY(1);    opacity: 1; }
        }
        @keyframes ripple {
          0%   { transform: scale(0.5); opacity: 0.7; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes fillWave {
          0%   { transform: translateY(42px); }
          100% { transform: translateY(-8px); }
        }
        @keyframes fallDrop {
          0%   { transform: translateY(-20px); opacity: 0; }
          20%  { opacity: 1; }
          100% { transform: translateY(80px);  opacity: 0; }
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; }
          40%            { opacity: 1;   }
        }
        .wdl-drop-main  { animation: dropBounce 1s cubic-bezier(.36,.07,.19,.97) forwards; }
        .wdl-fill       { animation: fillWave 2.4s ease-in-out infinite alternate; }
        .wdl-ripple     { animation: ripple 1.8s ease-out infinite; }
        .wdl-ripple-2   { animation-delay: 0.6s; }
        .wdl-ripple-3   { animation-delay: 1.2s; }
        .wdl-mini       { animation: fallDrop 1.6s ease-in infinite; }
        .wdl-mini-2     { animation-delay: 0.4s; }
        .wdl-mini-3     { animation-delay: 0.8s; }
        .wdl-mini-4     { animation-delay: 1.1s; }
        .wdl-dot-1      { animation: dotPulse 1.4s infinite; }
        .wdl-dot-2      { animation: dotPulse 1.4s 0.2s infinite; }
        .wdl-dot-3      { animation: dotPulse 1.4s 0.4s infinite; }
      `}</style>

      {/* ── Main drop ── */}
      <div className="relative flex items-center justify-center" style={{ width: 120, height: 140 }}>
        {/* Ripple rings */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: 80, height: 80 }}>
          {["wdl-ripple","wdl-ripple wdl-ripple-2","wdl-ripple wdl-ripple-3"].map((cls, i) => (
            <div key={i} className={cls} style={{ position:"absolute", inset:0, borderRadius:"50%", border:"2px solid rgba(56,189,248,0.55)" }} />
          ))}
        </div>

        {/* Drop body */}
        <div
          className="wdl-drop-main relative overflow-hidden"
          style={{
            width:78, height:96,
            borderRadius:"50% 50% 50% 50% / 60% 60% 40% 40%",
            background:"rgba(14,165,233,0.18)",
            border:"2.5px solid rgba(56,189,248,0.7)",
            backdropFilter:"blur(6px)",
            boxShadow:"0 0 32px rgba(56,189,248,0.35), inset 0 0 20px rgba(56,189,248,0.15)",
          }}
        >
          <div className="wdl-fill absolute inset-x-0" style={{ bottom:-8, height:"130%", background:"linear-gradient(180deg,rgba(56,189,248,0)0%,rgba(14,165,233,0.45)40%,rgba(2,132,199,0.75)100%)", borderRadius:"40% 60% 0 0 / 30% 40% 0 0" }} />
          <div style={{ position:"absolute", top:14, left:18, width:14, height:22, borderRadius:"50%", background:"rgba(255,255,255,0.3)", transform:"rotate(-20deg)" }} />
        </div>

        {/* Falling mini drops */}
        {[
          { left:"12%", size:7,  cls:"wdl-mini" },
          { left:"28%", size:5,  cls:"wdl-mini wdl-mini-2" },
          { left:"68%", size:6,  cls:"wdl-mini wdl-mini-3" },
          { left:"82%", size:4,  cls:"wdl-mini wdl-mini-4" },
        ].map((d, i) => (
          <div key={i} className={d.cls} style={{ position:"absolute", top:-24, left:d.left, width:d.size, height:d.size*1.3, borderRadius:"50% 50% 50% 50% / 60% 60% 40% 40%", background:"rgba(56,189,248,0.7)" }} />
        ))}
      </div>

      {/* Brand + message + dots */}
      <div className="mt-10 flex flex-col items-center gap-3">
        <span style={{ fontSize:22, fontWeight:700, letterSpacing:"0.08em", background:"linear-gradient(90deg,#38bdf8,#818cf8)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", fontFamily:"system-ui,sans-serif" }}>
          SenseFlow
        </span>
        <p style={{ color:"rgba(148,163,184,0.9)", fontSize:13, fontFamily:"system-ui,sans-serif", letterSpacing:"0.03em" }}>
          {message}
        </p>
        <div className="flex gap-1.5 mt-1">
          {["wdl-dot-1","wdl-dot-2","wdl-dot-3"].map((cls) => (
            <span key={cls} className={cls} style={{ display:"inline-block", width:6, height:6, borderRadius:"50%", background:"#38bdf8" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
