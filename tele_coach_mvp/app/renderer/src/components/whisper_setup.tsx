import { useState, useEffect } from "react";

type WhisperStatus = "checking" | "missing" | "downloading" | "verifying" | "ready" | "error";

interface WhisperSetupProps {
  status: WhisperStatus;
  progress?: number;
  step?: string;
  error?: string;
  onInstall: () => void;
  onRetry: () => void;
}

export function WhisperSetup({ status, progress, step, error, onInstall, onRetry }: WhisperSetupProps): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(status === "missing" || status === "downloading" || status === "verifying" || status === "error");
  }, [status]);

  if (!isVisible) return null;

  return (
    <div className="whisper-setup">
      <div className="whisper-setup__content">
        <h3 className="whisper-setup__title">Speech Engine Setup</h3>
        
        {status === "missing" && (
          <div className="whisper-setup__missing">
            <p className="whisper-setup__message">
              Speech engine is missing. Click Download to set it up.
            </p>
            <button 
              type="button" 
              className="whisper-setup__button whisper-setup__button--primary"
              onClick={onInstall}
            >
              Download
            </button>
          </div>
        )}

        {status === "downloading" && (
          <div className="whisper-setup__downloading">
            <p className="whisper-setup__message">{step || "Downloading..."}</p>
            {progress !== undefined && (
              <div className="whisper-setup__progress">
                <div 
                  className="whisper-setup__progress-bar" 
                  style={{ width: `${progress}%` }}
                />
                <span className="whisper-setup__progress-text">{progress}%</span>
              </div>
            )}
          </div>
        )}

        {status === "verifying" && (
          <div className="whisper-setup__verifying">
            <p className="whisper-setup__message">{step || "Verifying..."}</p>
            <div className="whisper-setup__spinner"></div>
          </div>
        )}

        {status === "error" && (
          <div className="whisper-setup__error">
            <p className="whisper-setup__message">
              {error || "Setup failed. Please retry."}
            </p>
            <button 
              type="button" 
              className="whisper-setup__button whisper-setup__button--secondary"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
