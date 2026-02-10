/**
 * Split text into segments based on newlines and sentence boundaries,
 * keeping the structure intact for reconstruction.
 */
export interface TextSegment {
  id: string;
  text: string;
  speaker: string; // Default to 'Narrator' or 'Unknown'
  isDialogue: boolean; // Heuristic: enclosed in quotes?
}

export function splitToSegments(text: string): TextSegment[] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n');
  const rawSegments = normalized.split('\n').filter(line => line.trim().length > 0);

  return rawSegments.flatMap((line, lineIndex) => {
      // Simple heuristic: If line starts with a quote, treat as one block for now
      // This can be refined to split "Dialogue," he said. "More dialogue."
      
      // Better Regex to split dialogue from narration within a line:
      // Captures: 1. Text before quote, 2. Quoted text, 3. Text after quote
      // This is a naive implementation; production NLP is harder, but this is better than "Generative"
      
      // For now, let's keep it simple: Split by newlines. 
      // If a line contains quotes, we might want to split it further, 
      // but let's stick to line-based for the MVP to ensure we don't break "text glue".
      // The AI will be asked to label the *whole line*.
      
      return {
          id: `seg-${lineIndex}-${Math.random().toString(36).substr(2, 9)}`,
          text: line.trim(),
          speaker: 'Narrator', // Default
          isDialogue: /["'«»]/.test(line)
      };
  });
}

export function reconstructText(segments: TextSegment[]): string {
  return segments.map(s => s.text).join('\n');
}
