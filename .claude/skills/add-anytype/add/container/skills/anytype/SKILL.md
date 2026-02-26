---
name: anytype
description: Search, create, and organize objects in the user's Anytype knowledge base. Use for structured notes, project tracking, knowledge management, and any data the user wants stored in Anytype.
---

# Anytype Knowledge Management

You have access to Anytype via MCP tools (`mcp__anytype__*`).

## Available Tools

### Search
- `mcp__anytype__search` — Global search across all spaces
- `mcp__anytype__search_objects` — Search objects within a specific space

### Spaces
- `mcp__anytype__list_spaces` — List all available spaces
- `mcp__anytype__get_space` — Get space details

### Objects
- `mcp__anytype__list_objects` — List objects in a space
- `mcp__anytype__get_object` — Get full object details
- `mcp__anytype__create_object` — Create a new object
- `mcp__anytype__update_object` — Update an existing object

### Organization
- `mcp__anytype__list_types` — List available object types in a space
- `mcp__anytype__list_templates` — List templates for a type
- `mcp__anytype__add_objects_to_list` — Add objects to a list/collection
- `mcp__anytype__list_members` — List space members

### Properties & Tags
- `mcp__anytype__list_properties` — List properties in a space
- `mcp__anytype__list_tags` — List tags for a property
- `mcp__anytype__create_tag` — Create a new tag

## Common Patterns

```
# Find something
Use mcp__anytype__search with a query string

# Create a note
1. mcp__anytype__list_spaces to find the right space
2. mcp__anytype__list_types to find the "Note" or "Page" type
3. mcp__anytype__create_object with the space ID and type ID

# Organize with tags
1. mcp__anytype__list_properties to find tag properties
2. mcp__anytype__create_tag or reference existing tags
3. mcp__anytype__update_object to apply tags
```

## When to Use Anytype

- User asks to save/store/remember something in Anytype
- Creating structured notes with types and properties
- Project or task tracking
- Knowledge base entries with relationships
- Anything the user explicitly asks to put in Anytype

## When NOT to Use Anytype

- Quick scratch notes (use workspace files in `/workspace/group/`)
- Sending messages to the user (use IPC)
- Data that belongs in Logseq (if user has both, ask which they prefer)
- Temporary data or intermediate computation results
