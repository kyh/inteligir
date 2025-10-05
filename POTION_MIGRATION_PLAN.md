# Potion Template Migration Plan

## Overview

This document outlines the comprehensive plan to migrate the Notion-like functionality from `apps/template-potion` to the existing `apps/nextjs` application, following the current monorepo conventions and architecture.

## Current Architecture Analysis

### Template-Potion App Features

- **Rich Text Editor**: Plate.js-based editor with extensive plugins
- **Document Management**: Create, read, update, delete documents with hierarchical structure
- **Collaboration**: Comments, discussions, and version control
- **File Uploads**: Media handling with UploadThing integration
- **AI Integration**: OpenAI-powered features and copilot functionality
- **Authentication**: Better-auth with GitHub OAuth
- **Database**: PostgreSQL with Prisma ORM

### Current Monorepo Structure

- **apps/nextjs**: Next.js app with Fumadocs integration
- **packages/api**: tRPC API layer with Better-auth
- **packages/db**: Drizzle ORM with Supabase integration
- **packages/ui**: Shared UI components

## Migration Strategy

### Phase 1: Database Schema Migration

#### 1.1 Convert Prisma Schema to Drizzle

**Target**: `packages/db/src/drizzle-schema.ts`

**Tables to migrate**:

- `Document` (new)
- `DocumentVersion` (new)
- `Discussion` (new)
- `Comment` (new)
- `File` (new)
- Note: User, OauthAccount, and Session tables are already handled by better-auth

**Key considerations**:

- Convert Prisma enums to Drizzle enums
- Maintain foreign key relationships
- Add proper indexes for performance
- Ensure compatibility with existing auth schema

#### 1.2 Update Database Types

**Target**: `packages/db/src/database.types.ts`

- Generate new types for document-related tables
- Maintain existing Supabase types
- Ensure type safety across the application

### Phase 2: API Layer Migration

#### 2.1 Create Document Router

**Target**: `packages/api/src/document/document-router.ts`

**Endpoints to migrate**:

- `document.document` - Get single document
- `document.documents` - List documents with pagination
- `document.create` - Create new document
- `document.update` - Update document
- `document.delete` - Delete document
- `document.archive` - Archive document
- `document.restore` - Restore archived document
- `document.trash` - List archived documents

#### 2.2 Create Comment Router

**Target**: `packages/api/src/comment/comment-router.ts`

**Endpoints to migrate**:

- `comment.discussions` - Get discussions for document
- `comment.createComment` - Create comment
- `comment.createDiscussion` - Create discussion
- `comment.createDiscussionWithComment` - Create discussion with initial comment
- `comment.updateComment` - Update comment
- `comment.deleteComment` - Delete comment
- `comment.removeDiscussion` - Remove discussion
- `comment.resolveDiscussion` - Resolve discussion

#### 2.3 Create Version Router

**Target**: `packages/api/src/version/version-router.ts`

**Endpoints to migrate**:

- `version.documentVersions` - Get document versions
- `version.documentVersion` - Get single version
- `version.createVersion` - Create version
- `version.deleteVersion` - Delete version
- `version.restoreVersion` - Restore version

#### 2.4 Create File Router

**Target**: `packages/api/src/file/file-router.ts`

**Endpoints to migrate**:

- File upload handling
- File management
- Integration with UploadThing

#### 2.5 Update Root Router

**Target**: `packages/api/src/root-router.ts`

- Add new routers to the main app router
- Maintain existing organization and waitlist routers

### Phase 3: Frontend Migration

#### 3.1 Editor Components Migration

**Target**: `apps/nextjs/src/components/editor/`

**Components to migrate**:

- Editor kit configuration
- Plate.js plugins and extensions
- Custom editor components
- Template system
- AI integration components
- Comment system components

#### 3.2 Document Management Pages

**Target**: `apps/nextjs/src/app/(dashboard)/`

**Pages to create**:

- `documents/page.tsx` - Document list/workspace
- `documents/[documentId]/page.tsx` - Document editor
- `documents/[documentId]/settings/page.tsx` - Document settings
- `documents/trash/page.tsx` - Archived documents

#### 3.3 Layout Updates

**Target**: `apps/nextjs/src/app/(dashboard)/layout.tsx`

- Add document navigation
- Integrate editor layout
- Add collaboration features

#### 3.4 State Management

**Target**: `apps/nextjs/src/lib/`

- Document state management
- Editor state persistence
- Real-time collaboration state

### Phase 4: Authentication Integration

#### 4.1 User Context Integration

**Target**: `packages/api/src/auth/`

- Ensure existing better-auth user context works with document operations
- Document ownership validation will use existing user ID from auth context
- No schema changes needed - better-auth handles all authentication

### Phase 5: Dependencies and Configuration

#### 5.1 Package Dependencies

**Target**: `apps/nextjs/package.json`

**New dependencies to add**:

- `platejs` - Rich text editor
- `@platejs/plate-*` - Editor plugins
- `@ai-sdk/react` - AI integration
- `uploadthing` - File uploads
- `jotai` - State management
- `lodash` - Utility functions

#### 5.2 Environment Variables

**Target**: `.env` files

**New variables**:

- `UPLOADTHING_TOKEN`
- `UPLOADTHING_APP_ID`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SITE_URL`

#### 5.3 Next.js Configuration

**Target**: `apps/nextjs/next.config.js`

- Add transpile packages for Plate.js
- Configure file upload handling
- Update image domains

### Phase 6: UI Components Integration

#### 6.1 Shared Components

**Target**: `packages/ui/src/`

**Components to add**:

- Document card components
- Editor toolbar components
- Comment system components
- File upload components

#### 6.2 Styling Integration

**Target**: `apps/nextjs/src/app/styles/`

- Integrate editor styles
- Add document-specific styles
- Maintain design system consistency

## Implementation Order

### Week 1: Database Foundation

1. Convert Prisma schema to Drizzle
2. Create database migrations
3. Update database types
4. Test database operations

### Week 2: API Layer

1. Create document router
2. Create comment router
3. Create version router
4. Create file router
5. Update root router
6. Test API endpoints

### Week 3: Core Frontend

1. Set up editor configuration
2. Create document pages
3. Implement basic document CRUD
4. Add document navigation

### Week 4: Advanced Features

1. Implement comment system
2. Add version control
3. Integrate file uploads
4. Add AI features

### Week 5: Polish and Testing

1. Add real-time collaboration
2. Implement advanced editor features
3. Add comprehensive testing
4. Performance optimization

Note: Authentication integration is simplified since better-auth handles everything - just use existing user context

## Technical Considerations

### Database Migration Strategy

- Use Drizzle migrations for schema changes
- Maintain data integrity during migration
- Create rollback procedures
- Test with production-like data

### API Compatibility

- Maintain existing API contracts
- Use consistent error handling
- Implement proper rate limiting
- Add comprehensive logging

### Frontend Integration

- Preserve existing routing structure
- Maintain design system consistency
- Ensure responsive design
- Optimize bundle size

### Performance Considerations

- Implement proper caching strategies
- Use React Query for data fetching
- Optimize editor performance
- Implement lazy loading

### Security Considerations

- Validate all user inputs
- Implement proper authorization
- Secure file uploads
- Protect against XSS attacks

## Testing Strategy

### Unit Tests

- Test all API endpoints
- Test database operations
- Test editor functionality
- Test authentication flows

### Integration Tests

- Test document creation workflow
- Test comment system
- Test file uploads
- Test version control

### E2E Tests

- Test complete user workflows
- Test collaboration features
- Test error scenarios
- Test performance

## Rollback Plan

### Database Rollback

- Keep Prisma schema as backup
- Create rollback migrations
- Document rollback procedures

### API Rollback

- Maintain API versioning
- Keep old endpoints during transition
- Implement feature flags

### Frontend Rollback

- Use feature flags for new features
- Maintain separate routes during transition
- Keep old components as fallback

## Success Metrics

### Functional Requirements

- [ ] All document CRUD operations working
- [ ] Comment system fully functional
- [ ] Version control working
- [ ] File uploads working
- [ ] AI features integrated
- [ ] Real-time collaboration working

### Performance Requirements

- [ ] Page load times < 2s
- [ ] Editor responsiveness < 100ms
- [ ] API response times < 500ms
- [ ] Bundle size increase < 50%

### Quality Requirements

- [ ] 90%+ test coverage
- [ ] Zero critical security vulnerabilities
- [ ] Accessibility compliance
- [ ] Cross-browser compatibility

## Risk Mitigation

### Technical Risks

- **Editor Performance**: Implement virtualization and optimization
- **Bundle Size**: Use code splitting and lazy loading
- **Database Performance**: Add proper indexes and query optimization
- **Real-time Features**: Use WebSocket connections efficiently

### Integration Risks

- **Breaking Changes**: Use feature flags and gradual rollout
- **Data Loss**: Implement comprehensive backups
- **User Experience**: Maintain consistent UI/UX patterns
- **Third-party Dependencies**: Pin versions and test thoroughly

## Conclusion

This migration plan provides a comprehensive roadmap for integrating the Potion template functionality into the existing nextjs application while maintaining the current architecture and conventions. The phased approach ensures minimal disruption to existing functionality while gradually introducing new features.

The success of this migration depends on careful planning, thorough testing, and maintaining consistency with the existing codebase patterns. Regular reviews and adjustments to the plan will be necessary as the migration progresses.
