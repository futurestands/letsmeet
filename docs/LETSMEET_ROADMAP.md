# LeTsMeet Roadmap

## Phase 1: SaaS foundation

### Database changes
- add organization and workspace tables
- add organization membership and role tracking
- add workspace scoping to meetings and scheduled meetings
- add status and lifecycle fields for meetings
- add tenant-aware RLS policies
- add usage tracking tables

### Backend changes
- enforce Supabase auth validation in token issuance
- verify room existence and membership before allowing LiveKit access
- add reusable database access helpers
- create secure meeting code generation utilities

### Frontend changes
- switch dashboard data from localStorage to persistent DB-backed queries
- add organization and workspace selection flow
- add loading, empty, and error states for meeting history
- remove random meeting IDs in scheduling and startup flows

### Infrastructure changes
- secure LiveKit token server settings
- define allowed origins and environment controls
- enable production-safe deployment configuration

### Security requirements
- no unrestricted access to meeting rows
- no arbitrary room code access without validation
- no service-role secrets in browser code
- no client-trusted role enforcement

### Testing requirements
- unit tests for meeting code generation and validation
- authorization tests for org/workspace access
- token issuance validation tests

### Acceptance criteria
- signed-in users can see only their allowed workspace data
- meeting codes are database-backed and validated server-side
- dashboard is backed by persistent records instead of localStorage
- LiveKit tokens require authenticated user verification

## Phase 2: Core conferencing

### Database changes
- meeting participant states and moderation metadata
- rooms and connection metadata
- chat message persistence and indexing

### Backend changes
- participant join/leave tracking
- chat storage and authorization
- room access state and host moderation

### Frontend changes
- participant roster and active speaker UI
- audio/video device controls and pre-join checks
- chat, reactions, and raise-hand flows

### Infrastructure changes
- LiveKit room policy and reconnect handling
- scaling for conference signaling and presence

### Security requirements
- only authorized participants can join or chat
- room moderation is enforced at the backend and DB

### Testing requirements
- join flow tests
- moderation action tests
- chat authorization tests

### Acceptance criteria
- users can connect, chat, and manage audio/video state in a valid room
- participant list reflects real join/leave state

## Phase 3: Meeting persistence and lifecycle

### Database changes
- scheduled meetings with time, recurrence, and metadata
- meeting status history and audit trail
- meeting record retention and lifecycle timestamps

### Backend changes
- schedule API and meeting creation flows
- lifecycle transitions for start/end/cancel
- historical retrieval and join validation

### Frontend changes
- scheduled meeting dashboard and history views
- meeting status cards and join entry points
- persistent record-based navigation

### Infrastructure changes
- query patterns optimized for history and reporting
- index tuning for meeting search and filtering

### Security requirements
- only owners and permissions-granted users can modify lifecycle state

### Testing requirements
- lifecycle transition tests
- schedule creation and validation tests

### Acceptance criteria
- meetings have durable database records and status history
- past meetings can be listed and joined according to policy

## Phase 4: Security and moderation

### Database changes
- waiting room and admission records
- moderation actions and audit logs
- invite and approval tables

### Backend changes
- host/co-host permission checks
- waiting room admission flow
- removal and mute enforcement

### Frontend changes
- moderation panel for host controls
- waiting room experience
- participant management actions

### Infrastructure changes
- logging and alerting for moderation events
- abuse detection hooks and monitoring

### Security requirements
- no bypass of moderation controls
- all moderator actions must be auditable

### Testing requirements
- moderation policy tests
- host/co-host access checks

### Acceptance criteria
- hosts can admit, deny, mute, and remove participants with auditable actions

## Phase 5: Scheduling and invitations

### Database changes
- recurring events and invite state tables
- timezone-aware scheduling metadata
- calendar integration hooks

### Backend changes
- invite creation and acceptance service
- scheduling validation and reminders

### Frontend changes
- calendar and scheduling UI
- invitation acceptance and RSVP state
- share links tied to real meeting records

### Infrastructure changes
- reminder workers and notification system

### Security requirements
- invites must be scoped to the correct workspace and source meeting
- only allowed users can send or manage invites

### Testing requirements
- scheduling edge-case tests
- invite flow verification tests

### Acceptance criteria
- meetings can be scheduled and shared with valid invitations

## Phase 6: Collaboration

### Database changes
- breakout room metadata
- polls and Q&A tables
- shared notes and whiteboard session records

### Backend changes
- collaboration state management
- room assignment logic
- persistence for session artifacts

### Frontend changes
- collaborative notes, whiteboard shell, polls, Q&A panel
- breakout room entry flow

### Infrastructure changes
- real-time data sync and persistence pipeline

### Security requirements
- vertical permission checks for collaborative actions
- tenant-bound collaboration spaces

### Testing requirements
- state transition and permission tests

### Acceptance criteria
- collaboration features operate within the correct workspace and meeting scope

## Phase 7: Recording and transcription

### Database changes
- recording metadata tables
- transcript and searchable artifact tables
- recording retention and access rules

### Backend changes
- recording lifecycle workers
- transcription pipeline and indexing service
- secure artifact retrieval

### Frontend changes
- recording status UI and playback access
- searchable transcript experience

### Infrastructure changes
- object storage and task queue configuration

### Security requirements
- retention and access control by org/workspace policy
- consent-aware recording and transcript generation

### Testing requirements
- pipeline and artifact access tests

### Acceptance criteria
- meetings can be recorded and transcribed with retrieved history and policy checks

## Phase 8: Scaling to 500 participants

### Database changes
- optimized indexes and partitioning strategy
- presence and analytics tables
- usage and capacity metrics

### Backend changes
- participant capacity controls and queueing logic
- optimization for media signaling and state sync

### Frontend changes
- responsive layouts for large-room participation
- ranked layout and active-speaker optimization

### Infrastructure changes
- LiveKit scaling, TURN, Redis, and load balancing
- queue and worker balancing for background tasks

### Security requirements
- scalable tenant isolation and abuse prevention
- capacity enforcement under org limits

### Testing requirements
- stress and concurrency tests
- large-room failover tests

### Acceptance criteria
- the platform remains stable and responsive at higher participant counts

## Phase 9: Organizations and enterprise

### Database changes
- enterprise settings and admin policy tables
- SSO and domain verification metadata
- audit log and compliance tables

### Backend changes
- org admin panels and workspace admins
- RBAC policy enforcement and usage limits
- enterprise reporting and security controls

### Frontend changes
- admin dashboards, user management, and workspace controls
- policy and compliance views

### Infrastructure changes
- enterprise security and operational dashboards
- environment isolation and backups

### Security requirements
- admin actions must be logged and auditable
- SSO and role controls must be verified before privilege assignment

### Testing requirements
- permission and admin boundary tests

### Acceptance criteria
- multi-tenant enterprise administration works with strong policy control

## Phase 10: AI meeting intelligence

### Database changes
- summary and action-item tables
- source transcript and knowledge indexing metadata

### Backend changes
- AI summarization and retrieval service
- action item extraction and knowledge search

### Frontend changes
- AI sidebar and meeting recap views
- searchable transcript and knowledge discovery

### Infrastructure changes
- model access, prompt control, and cost tracking

### Security requirements
- no cross-tenant AI retrieval
- policy-based data access for AI features

### Testing requirements
- content quality and permission tests

### Acceptance criteria
- AI-generated summaries and actions are accurate, scoped, and auditable

## Phase 11: Production hardening

### Database changes
- retention policy tables and maintenance jobs
- compliance data and audit evidence storage

### Backend changes
- rate limiting, retries, retries with backoff, and graceful failure handling
- operational dashboards and health probes

### Frontend changes
- accessibility refinement, performance optimization, and resilience states

### Infrastructure changes
- CDN, observability, failover infrastructure, and backups
- deployment automation and environment separation

### Security requirements
- full audit logging, secrets management, and incident response workflow

### Testing requirements
- regression tests, synthetic checks, and production readiness validation

### Acceptance criteria
- the platform is resilient, observable, secure, and production-ready
