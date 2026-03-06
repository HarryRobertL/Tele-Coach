interface TranscriptViewProps {
  partialText: string;
  finalText: string;
}

export function TranscriptView({ partialText, finalText }: TranscriptViewProps): JSX.Element {
  return (
    <section>
      <h2>Transcript</h2>
      <p><strong>Partial:</strong> {partialText || "No partial transcript yet."}</p>
      <p><strong>Final:</strong> {finalText || "No final transcript yet."}</p>
    </section>
  );
}
