import { MessageSquare, Plus } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/contexts/AuthContext";
import { useDataBridgeVersion } from "@/data/_bridge";
import { epics } from "@/data/epics";
import { projects } from "@/data/projects";
import { questions } from "@/data/questions";
import type { CommandAction } from "@/lib/commandActions";
import { COMMAND_NAVIGATION_ITEMS } from "@/lib/navigation";
import { useLocation } from "@/lib/router";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateQuestion: () => void;
  onOpenFeedback: () => void;
}

const SEARCH_ONLY_DEFAULT_HREFS = new Set([
  "/questions?view=expert",
  "/questions?view=waiting",
  "/questions?view=blocked",
]);

export function CommandMenu({ open, onOpenChange, onCreateQuestion, onOpenFeedback }: CommandMenuProps) {
  useDataBridgeVersion();
  const { me } = useAuth();
  const [, setLocation] = useLocation();
  const isAdmin = me?.role === "admin";

  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  const navigationActions: CommandAction[] = COMMAND_NAVIGATION_ITEMS
    .filter((item) => !item.adminOnly || isAdmin)
    .map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      group: item.group,
      keywords: [item.href],
      searchOnlyByDefault: SEARCH_ONLY_DEFAULT_HREFS.has(item.href),
      run: () => setLocation(item.href),
    }));

  const entityActions: CommandAction[] = [
    ...questions.slice(0, 40).map((question) => ({
      id: `question:${question.id}`,
      label: `${question.id} ${question.title}`,
      group: "Вопросы",
      keywords: [question.id, question.title, question.status, question.priority],
      run: () => setLocation(`/questions/${question.id}`),
    })),
    ...epics.slice(0, 25).map((epic) => ({
      id: `epic:${epic.id}`,
      label: `${epic.id} ${epic.name}`,
      group: "Эпики",
      keywords: [epic.id, epic.name, epic.epicStatus, epic.qaStatus],
      run: () => setLocation(`/epics/${epic.id}`),
    })),
    ...projects.slice(0, 25).map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      group: "Проекты",
      keywords: [project.id, project.name],
      run: () => setLocation(`/projects/${project.id}`),
    })),
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="⌘  Поиск, переход или команда..." />
      <style>{`
        [cmdk-root]:has([cmdk-input]:placeholder-shown) .command-search-only {
          display: none;
        }
      `}</style>
      <CommandList className="max-h-[440px]">
        <CommandEmpty>
          <div className="flex flex-col items-center gap-1 py-4 text-sm text-muted-foreground">
            Ничего не найдено
          </div>
        </CommandEmpty>

        <CommandGroup heading="Действия">
          <CommandItem
            value="create-question-new"
            onSelect={() => run(onCreateQuestion)}
            data-testid="command-create-question"
          >
            <Plus size={16} />
            Задать вопрос
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="feedback обратная связь баг предложение"
            onSelect={() => run(onOpenFeedback)}
            data-testid="command-open-feedback"
          >
            <MessageSquare size={16} />
            Обратная связь
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Переходы">
          {navigationActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords ?? [])].join(" ")}
              onSelect={() => run(action.run)}
              className={action.searchOnlyByDefault ? "command-search-only" : undefined}
            >
              {action.label}
              <CommandShortcut>{action.group}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Найти">
          {entityActions.map((action) => (
            <CommandItem
              key={action.id}
              value={[action.label, ...(action.keywords ?? [])].join(" ")}
              onSelect={() => run(action.run)}
            >
              <span className="truncate">{action.label}</span>
              <CommandShortcut>{action.group}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
