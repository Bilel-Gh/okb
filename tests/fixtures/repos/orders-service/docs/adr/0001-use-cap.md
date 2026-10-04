# 1. Use SAP CAP for the orders service

Date: 2024-03-12

## Context

The previous orders service was a custom Express application with hand-written
OData. Every new field needed changes in three places.

## Decision

We rebuild the service with SAP CAP: the CDS model generates the OData service
and the database schema, and handlers hold only business rules.

## Consequences

The team needs CAP training. Custom routes are discouraged: everything goes
through CDS services.
