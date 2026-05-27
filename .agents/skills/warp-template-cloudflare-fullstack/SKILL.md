```markdown
# warp-template-cloudflare-fullstack Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the core development patterns and conventions used in the `warp-template-cloudflare-fullstack` repository. The codebase is a TypeScript fullstack template leveraging the Vite framework, designed for rapid development and deployment on Cloudflare. This guide documents file naming, import/export styles, commit patterns, and testing strategies to ensure consistency and maintainability.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `apiHandler.ts`

### Import Style
- Use **alias imports** to reference modules.
  - Example:
    ```typescript
    import { fetchData } from '@/utils/api'
    ```

### Export Style
- Mixed: Both default and named exports are used.
  - Example (named export):
    ```typescript
    export function getUser() { ... }
    ```
  - Example (default export):
    ```typescript
    export default App
    ```

### Commit Patterns
- Commit messages are **freeform** with no strict type prefixes.
- Messages are concise, averaging 16 characters.
  - Example: `fix login bug`

## Workflows

### Development Workflow
**Trigger:** When starting new features or making changes  
**Command:** `/dev-start`

1. Create a new branch for your feature or fix.
2. Write code following the conventions above.
3. Use alias imports and camelCase file names.
4. Commit changes with a concise, descriptive message.
5. Push your branch and open a pull request.

### Testing Workflow
**Trigger:** When adding or updating code  
**Command:** `/run-tests`

1. Write or update test files using the `*.test.*` pattern.
2. Run the test suite (testing framework is currently unknown; refer to project scripts).
3. Ensure all tests pass before merging.

### Code Review Workflow
**Trigger:** When a pull request is opened  
**Command:** `/review-pr`

1. Review code for adherence to conventions.
2. Check for proper import/export usage and file naming.
3. Verify that tests are present and passing.
4. Approve or request changes as needed.

## Testing Patterns

- Test files follow the `*.test.*` naming convention.
  - Example: `userProfile.test.ts`
- The specific testing framework is not specified; check project scripts or documentation for details.
- Place tests alongside the code they cover or in a dedicated `tests` directory.

## Commands
| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| /dev-start    | Start a new development branch/feature       |
| /run-tests    | Run the test suite                           |
| /review-pr    | Review a pull request for code quality       |
```