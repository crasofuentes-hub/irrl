# Contributing to IRRL

Thank you for your interest in contributing to IRRL! This document provides guidelines and information for contributors.

## Code of Conduct

Be respectful, inclusive, and constructive. We're building infrastructure for trust—let's embody that in our interactions.

## How to Contribute

### Reporting Issues

1. Check existing issues first
2. Use the issue template
3. Provide:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details

### Suggesting Features

1. Open a discussion first
2. Explain the use case
3. Consider backwards compatibility
4. Be open to alternative approaches

### Contributing Code

#### Setup

```bash
# Fork and clone
git clone https://github.com/yourusername/irrl.git
cd irrl

# Install dependencies
cd apps/api
npm install

# Setup database
createdb irrl_dev
npm run db:migrate

# Run tests
npm test

# Start development server
npm run dev
```

#### Development Workflow

1. Create a feature branch
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes
   - Follow the code style
   - Add tests for new functionality
   - Update documentation

3. Run checks
   ```bash
   npm run lint
   npm test
   ```

4. Commit with clear messages
   ```bash
   git commit -m "feat: add new resolver for DNS verification"
   ```

5. Push and create PR
   ```bash
   git push origin feature/your-feature-name
   ```

### Commit Message Format

We use conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance

Examples:
```
feat: add prediction-accuracy resolver
fix: correct transitive trust decay calculation
docs: update API documentation for proofs endpoint
refactor: simplify trust graph BFS implementation
```

## Code Style

### TypeScript

- Use strict mode
- Prefer `const` over `let`
- Use explicit types for function parameters
- Document public APIs with JSDoc

```typescript
/**
 * Compute transitive trust between two entities
 * @param from - Source entity ID
 * @param to - Target entity ID
 * @param options - Computation options
 * @returns Trust result with score, confidence, and paths
 */
export function computeTransitiveTrust(
  from: EntityId,
  to: EntityId,
  options: TransitiveTrustOptions
): TransitiveTrustResult {
  // Implementation
}
```

### SQL

- Use lowercase keywords
- Use snake_case for identifiers
- Add comments for complex queries

```sql
-- Get reputation with decay applied
select 
  subject_id,
  score * power(0.5, extract(days from now() - computed_at) / 180) as decayed_score
from reputation_cache
where realm_id = $1
  and valid_until > now();
```

## Adding a Resolver

Resolvers are the primary extension point. Here's how to add one:

### 1. Create the Resolver

```typescript
// src/resolvers/myResolver.ts
import { BaseResolver } from "./index";
import { ResolverMetadata, VerificationResult } from "../core/types";

export class MyResolver extends BaseResolver {
  metadata: ResolverMetadata = {
    id: "my-resolver",
    version: "1.0.0",
    name: "My Custom Resolver",
    description: "Verifies X by checking Y",
    author: "your-id",
    evidenceSchema: {
      type: "object",
      required: ["field1", "field2"],
      properties: {
        field1: { type: "string" },
        field2: { type: "number" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        result: { type: "boolean" },
        details: { type: "string" },
      },
    },
    domains: ["your-domain"],
    deterministic: true,
    avgVerificationTime: 100,
  };

  async verify(evidence: Record<string, unknown>): Promise<VerificationResult> {
    try {
      // Your verification logic here
      const field1 = evidence.field1 as string;
      const field2 = evidence.field2 as number;
      
      // Perform verification
      const isValid = await this.performCheck(field1, field2);
      
      return this.createResult(
        isValid ? "verified" : "failed",
        { result: isValid, details: "Verification complete" },
        { field1, field2, checkedAt: new Date().toISOString() }
      );
    } catch (error) {
      return this.createResult(
        "error",
        {},
        evidence,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
  
  private async performCheck(field1: string, field2: number): Promise<boolean> {
    // Implementation
    return true;
  }
}
```

### 2. Register the Resolver

```typescript
// src/resolvers/index.ts
import { MyResolver } from "./myResolver";

export function registerBuiltInResolvers(): void {
  // ... existing resolvers
  resolverRegistry.register(new MyResolver());
}
```

### 3. Add Tests

```typescript
// src/resolvers/myResolver.test.ts
import { describe, it, expect } from "vitest";
import { MyResolver } from "./myResolver";

describe("MyResolver", () => {
  const resolver = new MyResolver();
  
  it("should verify valid evidence", async () => {
    const result = await resolver.verify({
      field1: "valid",
      field2: 42,
    });
    
    expect(result.status).toBe("verified");
  });
  
  it("should fail invalid evidence", async () => {
    const result = await resolver.verify({
      field1: "invalid",
      field2: -1,
    });
    
    expect(result.status).toBe("failed");
  });
});
```

### 4. Document

Add documentation in the resolver's JSDoc and update README if it's a significant addition.

## Testing

### Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Specific file
npm test -- src/resolvers/myResolver.test.ts
```

### Writing Tests

- Test happy path and edge cases
- Mock external dependencies
- Use descriptive test names

```typescript
describe("TrustGraph", () => {
  describe("computeTransitiveTrust", () => {
    it("should return direct trust when edge exists", () => {
      // ...
    });
    
    it("should compute transitive trust through intermediaries", () => {
      // ...
    });
    
    it("should apply decay factor per hop", () => {
      // ...
    });
    
    it("should respect maxDepth limit", () => {
      // ...
    });
  });
});
```

## Documentation

- Update README for user-facing changes
- Update ARCHITECTURE.md for internal changes
- Add JSDoc for public APIs
- Include examples where helpful

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create PR with changes
4. After merge, tag release
5. CI publishes to npm (planned)

## Questions?

- Open a GitHub Discussion
- Check existing issues
- Read the documentation

## Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes
- (Future) Contributors page on website

Thank you for contributing to IRRL! 🙏
