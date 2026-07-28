const COMMANDS = [
  "start",
  "add",
  "edit",
  "stop",
  "status",
  "list-projects",
  "continue",
  "report",
  "config",
  "completion",
] as const;

// Kept as a static list rather than generated from the Commander program:
// completion scripts run in a separate shell process, long after this CLI
// has exited, so they can't introspect `program` at all — they only ever
// see whatever text is baked in here at print time.
export const BASH_COMPLETION = `_toggl_completions() {
  local cur commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  commands="${COMMANDS.join(" ")}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi
  case "\${COMP_WORDS[1]}" in
    report)
      [ "$COMP_CWORD" -eq 2 ] && COMPREPLY=( $(compgen -W "today week" -- "$cur") )
      ;;
    completion)
      [ "$COMP_CWORD" -eq 2 ] && COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") )
      ;;
  esac
}
complete -F _toggl_completions toggl togglr
`;

// The "#compdef" header only does anything when zsh's compinit loads this
// file itself off fpath — it's an inert comment when the script is eval'd
// directly (our "eval \\"$(toggl completion zsh)\\"" install path), which is
// why this ends by explicitly calling compdef instead of relying on it.
export const ZSH_COMPLETION = `#compdef toggl togglr

_toggl() {
  local -a commands
  commands=(
    'start:Start a new timer'
    'add:Manually add a completed entry for today'
    'edit:Edit an existing entry'
    'stop:Stop the running timer'
    'status:Show the current timer and elapsed time'
    'list-projects:List cached projects'
    'continue:Repeat the most recent time entry'
    'report:Print a per-project time breakdown'
    'config:View or change togglr settings'
    'completion:Print a shell completion script'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case \${words[2]} in
    report)
      (( CURRENT == 3 )) && _values 'range' today week
      ;;
    completion)
      (( CURRENT == 3 )) && _values 'shell' bash zsh
      ;;
  esac
}

# compdef itself is a shell function that compinit defines — if the user's
# rc file eval's us before ever running compinit, load it now rather than
# silently doing nothing.
if ! command -v compdef >/dev/null 2>&1; then
  autoload -Uz compinit
  compinit
fi
compdef _toggl toggl togglr
`;

export function getCompletionScript(shell: string): string | null {
  if (shell === "bash") return BASH_COMPLETION;
  if (shell === "zsh") return ZSH_COMPLETION;
  return null;
}
