# web-app-scaffold Specification

## Purpose

Bootstrapped Astro + React islands + TypeScript app and its verification surface (greenfield repo).

## Requirements

### Requirement: Scaffold, public route, and verification

The repository MUST provide an Astro + React islands + TypeScript app serving `/b/[slug]`, rendering context and services from the public DTO reads — never hardcoded. The project MUST define passing Astro build and TypeScript typecheck verification commands; exact invocations are decided in design/tasks.

#### Scenario: Build and typecheck pass

- GIVEN a clean checkout with dependencies
- WHEN build runs, then typecheck runs
- THEN both exit successfully
