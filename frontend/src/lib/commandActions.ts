export interface CommandAction {
  id: string;
  label: string;
  group: string;
  keywords?: string[];
  shortcut?: string;
  searchOnlyByDefault?: boolean;
  run: () => void;
}
