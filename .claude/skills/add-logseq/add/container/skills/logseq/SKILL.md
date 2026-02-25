---
name: logseq
description: Read and write to the user's Logseq knowledge graph. Use for storing knowledge, research notes, daily journals, and structured information.
---

# Logseq Knowledge Graph

The user's Logseq graph is mounted at `/workspace/logseq` (read-write).

## Directory Structure

```
/workspace/logseq/
  pages/          # Named pages (one .md file per page)
  journals/       # Daily journal entries
  logseq/         # Logseq config — DO NOT MODIFY
  assets/         # Attached files — DO NOT MODIFY
```

## Reading

```bash
# List all pages
ls /workspace/logseq/pages/

# Read a specific page
cat /workspace/logseq/pages/ProjectAlpha.md

# Search across all pages and journals
grep -rl "search term" /workspace/logseq/pages/ /workspace/logseq/journals/

# Search with context
grep -rn "search term" /workspace/logseq/pages/

# Find pages modified recently
find /workspace/logseq/pages/ -name "*.md" -mtime -7

# Read today's journal
cat /workspace/logseq/journals/2026_02_24.md
```

## Writing Format

Logseq uses **outliner format**. Every line of content MUST be a bullet point starting with `- `.

```markdown
- This is a top-level block
  - This is a nested child block
  - Another child block
    - Deeply nested block
```

### Properties

Use `key:: value` syntax (double colon) for metadata properties:

```markdown
- title:: Meeting Notes
  type:: meeting
  date:: 2026-02-24
  - Discussed the roadmap
  - Action items assigned
```

### Wiki Links

Link to other pages with `[[PageName]]`:

```markdown
- Talked to [[John]] about [[ProjectAlpha]]
  - He suggested using [[React]] for the frontend
```

### Tags

Use `#tag` for inline tags:

```markdown
- Important task #todo #urgent
```

## Creating New Pages

Create a `.md` file in `pages/`. The filename IS the page title.

```bash
# Create a new page called "Meeting Notes 2026-02-24"
cat > "/workspace/logseq/pages/Meeting Notes 2026-02-24.md" << 'EOF'
- title:: Meeting Notes 2026-02-24
  type:: meeting
  - Attendees: [[Alice]], [[Bob]]
  - Discussed Q1 roadmap
    - Frontend rewrite approved
    - Backend migration delayed to Q2
  - Action items
    - [[Alice]] to draft the RFC #todo
    - [[Bob]] to update timeline #todo
EOF
```

## Journal Entries

Journal filenames use **underscores**, NOT hyphens: `YYYY_MM_DD.md`

```bash
# Add to today's journal (append)
cat >> /workspace/logseq/journals/2026_02_24.md << 'EOF'
- Researched Logseq integration
  - Found the API docs at [[Logseq API]]
  - Created a prototype #done
EOF

# Create a new journal entry (only if it doesn't exist)
cat > /workspace/logseq/journals/2026_02_24.md << 'EOF'
- Weather today: sunny, 72F
- Started working on the new feature
  - See [[ProjectAlpha]] for details
EOF
```

## When to Use Logseq

- Storing research findings and summaries
- Knowledge base entries the user wants to keep
- Meeting notes and task logs
- Daily journal entries (what was done, what was learned)
- Structured information with relationships (wiki links)
- Anything the user explicitly asks to save to Logseq or their notes

## When NOT to Use Logseq

- Temporary scratch work or intermediate results (use workspace files in `/workspace/group/`)
- Sending messages to the user (use `send_message` via IPC)
- Configuration or code files (use the appropriate project directories)
- Large data dumps or binary files (use workspace files)
