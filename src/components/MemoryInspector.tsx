import { useMemo, useState } from "react";
import { Brain, Lock, Unlock, Trash2, Pencil, Check, X, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMemori, type MemoryTriple } from "@/hooks/useMemori";
import { toast } from "sonner";

interface MemoryInspectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  voice: "Voice",
  recurring: "Prose",
  thematic: "Theme",
  character_voice: "Character",
  world_rule: "World Rule",
  failure: "Avoid",
  golden: "Golden",
  session: "Session",
  fact: "Fact",
};

const MemoryInspector = ({ open, onOpenChange }: MemoryInspectorProps) => {
  const { triples, updateTriple, toggleLock, deleteTriple, loading } = useMemori();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<MemoryTriple | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    triples.forEach(t => set.add(t.category));
    return ["all", ...Array.from(set).sort()];
  }, [triples]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return triples
      .filter(t => activeCategory === "all" || t.category === activeCategory)
      .filter(t => {
        if (!q) return true;
        return (
          t.subject.toLowerCase().includes(q) ||
          t.predicate.toLowerCase().includes(q) ||
          t.object_value.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.locked && !b.locked) return -1;
        if (!a.locked && b.locked) return 1;
        return b.confidence - a.confidence;
      });
  }, [triples, search, activeCategory]);

  const startEdit = (t: MemoryTriple) => {
    setEditingId(t.id);
    setEditValue(t.object_value);
  };

  const saveEdit = async (t: MemoryTriple) => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error("Fact text cannot be empty");
      return;
    }
    await updateTriple(t.id, { object_value: trimmed });
    setEditingId(null);
    toast.success("Fact updated");
  };

  const handleToggleLock = async (t: MemoryTriple) => {
    await toggleLock(t.id);
    toast.success(t.locked ? "Fact unlocked" : "Fact locked — protected from decay");
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await deleteTriple(confirmDelete.id);
    toast.success("Fact deleted from memory");
    setConfirmDelete(null);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="px-5 pt-5 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Story Memory ({triples.length})
            </SheetTitle>
            <SheetDescription className="text-xs">
              Every canonical fact Memori knows about your story. Lock anything that must never change,
              edit anything that's wrong, delete noise.
            </SheetDescription>
          </SheetHeader>

          <div className="px-5 py-3 border-b space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search facts (name, world rule, etc.)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            <Tabs value={activeCategory} onValueChange={setActiveCategory}>
              <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                {categories.map(cat => {
                  const count = cat === "all" ? triples.length : triples.filter(t => t.category === cat).length;
                  if (count === 0 && cat !== "all") return null;
                  return (
                    <TabsTrigger
                      key={cat}
                      value={cat}
                      className="h-7 px-2.5 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground border"
                    >
                      {cat === "all" ? "All" : (CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " "))}
                      <span className="ml-1 opacity-70 tabular-nums">{count}</span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {loading ? (
                <p className="text-center text-xs text-muted-foreground py-8">Loading memory…</p>
              ) : filtered.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">
                  {triples.length === 0 ? "No facts in memory yet. Upload an outline or commit a chapter." : "No facts match your filter."}
                </p>
              ) : (
                filtered.map(t => (
                  <div
                    key={t.id}
                    className={`rounded-md border p-2.5 text-xs space-y-1.5 ${
                      t.locked ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                        {CATEGORY_LABELS[t.category] ?? t.category}
                      </Badge>
                      <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[12rem]">
                        {t.subject} <span className="opacity-60">·</span> {t.predicate}
                      </span>
                      <span className={`ml-auto text-[10px] tabular-nums ${
                        t.confidence >= 0.75 ? "text-primary" : "text-muted-foreground"
                      }`}>
                        {Math.round(t.confidence * 100)}%
                      </span>
                    </div>

                    {editingId === t.id ? (
                      <div className="space-y-1.5">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-7 text-xs"
                          autoFocus
                        />
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="default" className="h-6 px-2 text-[11px]" onClick={() => saveEdit(t)}>
                            <Check className="h-3 w-3 mr-1" />Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditingId(null)}>
                            <X className="h-3 w-3 mr-1" />Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-foreground leading-snug">{t.object_value}</p>
                    )}

                    {editingId !== t.id && (
                      <div className="flex gap-1 pt-0.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => handleToggleLock(t)}
                          title={t.locked ? "Unlock — allow decay" : "Lock — protect this fact forever"}
                        >
                          {t.locked ? <Lock className="h-3 w-3 mr-1 text-primary" /> : <Unlock className="h-3 w-3 mr-1" />}
                          {t.locked ? "Locked" : "Lock"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => startEdit(t)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive"
                          onClick={() => setConfirmDelete(t)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />Delete
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this fact from memory?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <span className="block mt-2 rounded border bg-muted/40 p-2 text-xs font-mono text-foreground">
                  {confirmDelete.subject} → {confirmDelete.predicate} → {confirmDelete.object_value}
                </span>
              )}
              <span className="block mt-2">
                The AI will no longer remember this. It may re-learn it from your uploads or chapters.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default MemoryInspector;
