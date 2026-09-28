# Connecting an existing laboratory system

LabLink can run as a laboratory workspace or as a notification and portal add-on. Connected mode enables an authenticated inbound API; the existing laboratory system remains responsible for its laboratory processing and result authorization. A vendor-specific connector must map that system's events into the contract below. Enabling connected mode does not automatically connect to a vendor database.

## Setup

1. Create the workspace administrator. In Settings, provision any clinician, patient or transporter portal accounts required.
2. Open Communications, select connected mode, and generate an integration key. Save the one-time key in the source system's secret manager. Rotation immediately invalidates the previous key. The database stores its hash.
3. Configure the connector to POST JSON to `https://YOUR-LABLINK-HOST/api/integrations/events` with `Authorization: Bearer YOUR_KEY` and `Content-Type: application/json`.
4. Use a stable `source` identifier and source specimen identifier. Every event needs a stable, unique `eventId` within its source. Retries must reuse the same ID and content.
5. Test using synthetic records and preview delivery before configuring live providers. Configure portal account IDs explicitly; contact email addresses do not grant portal access.

The API accepts at most 120 authenticated event requests per minute per running application process. Request bodies are limited to 32 KB. It does not accept a browser login cookie in place of an integration key. Administration of integration settings still requires an administrator session and CSRF token.

## Reception

```json
{
  "source": "existing-lis",
  "eventId": "evt-0001",
  "externalSampleId": "LIS-12345",
  "event": "received",
  "sample": {
    "patientName": "Synthetic Patient",
    "patientId": "TEST-001",
    "testName": "Test assay",
    "sampleType": "Blood",
    "facility": "Test Clinic",
    "referringDoctor": "Test Clinician",
    "department": "Chemistry",
    "priority": "routine",
    "collectedAt": "2026-09-25T08:00:00Z",
    "requestKind": "clinician",
    "contacts": {
      "patient": { "email": "patient@example.test", "channels": ["email"] },
      "clinician": { "phone": "+15555550123", "channels": ["sms"] },
      "transporter": { "phone": "+15555550124", "channels": ["whatsapp"] }
    }
  }
}
```

Each contact can additionally contain `name` and `portalUserId`. Portal IDs must identify an existing account with the corresponding role. Supported channels are `email`, `sms` and `whatsapp`. Phone numbers use international E.164 format. Supplying contact information without selecting a channel does not request external delivery. Use `requestKind: "self"` for a patient who directly requested testing from the laboratory.

## Status events

Use the same `source` and `externalSampleId` on subsequent events. Examples show the additional fields needed alongside `eventId`:

| Event                  | Additional fields                         | Behavior                                                                                                                        |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rejected`             | `reason`, `instructions`                  | Requires recollection; clinician receives the reason, patient receives generic instructions to visit their healthcare provider. |
| `delayed`              | `reason`                                  | Persists a delay alert and sends generic status messages to patient and clinician.                                              |
| `results_available`    | `resultSummary`, `releaseConfirmed: true` | Imports an already authorized result, records external LIS provenance, and notifies recipients.                                 |
| `replacement_received` | `parentExternalSampleId`, `collectedAt`   | Registers a linked replacement under a new `externalSampleId`; retains the original rejection history.                          |

For example:

```json
{
  "source": "existing-lis",
  "eventId": "evt-0002",
  "externalSampleId": "LIS-12345",
  "event": "results_available",
  "resultSummary": "Synthetic result for connector verification only.",
  "releaseConfirmed": true
}
```

Only send `results_available` after authorization in the originating laboratory system. LabLink records that external authorization; it does not invent a local quality check. Rejected specimens require a replacement before results can be released. External events cannot grant patients permission to see clinician-requested results.

## Responses and retries

A new accepted event returns HTTP 201, for example `{"sampleId": 42, "duplicate": false}`. An exact retry returns HTTP 200 and `duplicate: true`, without creating another specimen or notification. Reusing an event ID with different content returns 409. Import reception before status updates; unknown external specimens return 404. Events, specimen updates, audit history and queued messages commit together.

Validation errors return 400. Invalid keys return 401; disabled integration returns 403. State conflicts return 409. Retry transient server errors or rate limits using backoff and the original event ID; correct validation or ordering errors first. Do not rotate event IDs to bypass conflicts. A source must serialize events for an individual specimen.

Turning connected mode off stops incoming events. It does not delete imported records or cancel previously queued notifications. Deleting the integration key through `DELETE /api/integration/key` revokes access; key rotation is also available in the interface.

## Product boundaries

The API supports specimen status and released text summaries. It does not yet parse HL7/FHIR messages, analyzer protocols, PDF result attachments or vendor database schemas. A connector and mapping agreement are needed for each vendor. The standalone application provides specimen operations, verification, recollections, portals and communications; stock inventory, purchasing, billing and instrument quality-control modules are separate future work.
