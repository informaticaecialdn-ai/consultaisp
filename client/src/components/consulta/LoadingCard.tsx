import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { LOADING_STEPS } from "./constants";

export default function LoadingCard() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let elapsed = 0;
    const totalDur = LOADING_STEPS.reduce((s, st) => s + st.duration, 0);
    const tick = setInterval(() => {
      elapsed += 100;
      const pct = Math.min((elapsed / totalDur) * 90, 90);
      setProgress(Math.floor(pct));
      let cum = 0;
      for (let i = 0; i < LOADING_STEPS.length; i++) {
        cum += LOADING_STEPS[i].duration;
        if (elapsed < cum) { setCurrentStep(i); break; }
        if (i === LOADING_STEPS.length - 1) setCurrentStep(i);
      }
    }, 100);
    return () => clearInterval(tick);
  }, []);

  return (
    <Card className="p-8 shadow-lg rounded-lg">
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin flex-shrink-0" />
          <div>
            <p className="text-lg font-semibold text-slate-900">Consultando rede ISP colaborativa...</p>
            <p className="text-sm text-slate-500">Aguarde, buscando em multiplos provedores simultaneamente</p>
          </div>
        </div>

        <div className="space-y-3">
          {LOADING_STEPS.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <div key={step.id} className={`flex items-start gap-3 p-3 rounded-lg transition-all duration-500 ${active ? "bg-blue-50 border border-blue-200" : done ? "opacity-60" : "opacity-30"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${done ? "bg-emerald-500" : active ? "bg-blue-600" : "bg-slate-200"}`}>
                  {done ? (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : active ? (
                    <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  ) : (
                    <span className="text-xs font-bold text-slate-400">{step.id}</span>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-semibold ${active ? "text-blue-800" : done ? "text-emerald-700" : "text-slate-400"}`}>{step.label}</p>
                  {active && <p className="text-xs text-blue-600 mt-0.5">{step.detail}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-500 text-right">{progress}%</p>
        </div>
      </div>
    </Card>
  );
}
