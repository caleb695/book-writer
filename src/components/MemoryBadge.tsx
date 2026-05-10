import { useMemo } from "react";
import { Brain } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface MemoryBadgeProps {
  /** The full UltraContext injection string that will be sent with the next request. */
  injection?: string;
  /** Total number of triples available in Memori. */
  totalTriples?: number;
  /** Optional list of category counts for breakdown. */
  categoryCounts?: Record<string, number>;
  /** Optional compact mode for tight UI. */
  compact?: boolean;
}

/**
 * Small visual indicator showing how much story memory will be injected
 * into the next AI request. Hover to see a breakdown.
 */
const MemoryBadge = ({ injection = "", totalTriples = 0, categoryCounts, compact }: MemoryBadgeProps) => {
  const stats = useMemo(() => {
    const text = injection || "";
    const charCount = text.length;
    const approxTokens = Math.round(charCount / 4);
    // Each layer in ultraContext is separated by a blank line + heading; count "##" headings as a proxy for active layers
    const layers = (text.match(/\n##\s+/g) || []).length + (text.startsWith("##") ? 1 : 0);
    return { charCount, approxTokens, layers };
  }, [injection]);

  const isActive = totalTriples > 0 || stats.charCount > 0;

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
            isActive
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted/40 text-muted-foreground"
          } ${compact ? "h-5" : "h-6"}`}
          aria-label="Memory injection details"
        >
          <Brain className="h-3 w-3" />
          <span className="tabular-nums">
            {isActive ? `${totalTriples} fact${totalTriples === 1 ? "" : "s"}` : "No memory"}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 p-3 text-xs">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <Brain className="h-3.5 w-3.5 text-primary" />
            <span>Story Memory Injection</span>
          </div>

          {!isActive ? (
            <p className="text-muted-foreground leading-relaxed">
              No memory has been recorded yet. Upload an outline or reference book in the
              <span className="font-medium text-foreground"> Files</span> tab, or commit an AI-written chapter,
              and Memori will start tracking canonical facts.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                <span>Total facts known:</span>
                <span className="text-right font-medium text-foreground tabular-nums">{totalTriples}</span>
                <span>Injected this request:</span>
                <span className="text-right font-medium text-foreground tabular-nums">~{stats.approxTokens.toLocaleString()} tok</span>
                <span>Active context layers:</span>
                <span className="text-right font-medium text-foreground tabular-nums">{stats.layers || (stats.charCount > 0 ? 1 : 0)}</span>
              </div>

              {categoryCounts && Object.keys(categoryCounts).length > 0 && (
                <div className="border-t pt-2 space-y-1">
                  <p className="font-medium text-foreground">By category</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                    {Object.entries(categoryCounts)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 8)
                      .map(([cat, count]) => (
                        <div key={cat} className="flex justify-between">
                          <span className="capitalize truncate">{cat.replace(/_/g, " ")}</span>
                          <span className="tabular-nums text-foreground">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/80 border-t pt-2 leading-relaxed">
                These facts are sent with every chapter generation and brainstorming request to keep
                names, relationships, and world rules consistent.
              </p>
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default MemoryBadge;
