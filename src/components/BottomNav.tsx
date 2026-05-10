import { FileText, Sparkles, BookOpen, FlaskConical, Palette } from "lucide-react";

export type TabId = "files" | "ai" | "style" | "development" | "document";

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "files", label: "Files", icon: FileText },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "style", label: "Style", icon: Palette },
  { id: "development", label: "Develop", icon: FlaskConical },
  { id: "document", label: "Document", icon: BookOpen },
];

const BottomNav = ({ activeTab, onTabChange }: BottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-16 border-t bg-card/80 backdrop-blur-md">
      <div className="grid h-full grid-cols-5 max-w-lg mx-auto">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
