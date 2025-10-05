Title: Extract Inline Component
Description: Extracts a React component within the same file, placing it below the source component. Uses destructured props and inline type. Avoids passing context state or hooks as props (including useApi). Useful for organizing code without creating separate files.
Body:

${TM_SELECTED_TEXT}

```tsx
function ${1:ComponentName}({ ${2:prop}, ...props }: { ${2}: ${3:type} }) {
  return (
    $0
  )
}
```

### Example

Title: Extract Inline Component
Description: Extracts a React component within the same file, placing it below the source component. Uses destructured props and inline type. Avoids passing context state or hooks as props (including useApi). Useful for organizing code without creating separate files.
Body:

```tsx
export function ParentComponent() {
  return (
    <div>
      <${1:ComponentName} ${2:prop}={someValue} />
    </div>
  )
}

function ${1:ComponentName}({ ${2:prop}, ...props }: { ${2}: ${3:type} }) {
  return (
    $0
  )
}
```
