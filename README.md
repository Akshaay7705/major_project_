# Live Avatar Transcript Feature Integration Guide

This folder contains the complete code for adding a live transcript feature to your HeyGen Live Avatar project.

## Included Files

- `src/liveavatar/context.tsx`: Enhanced context provider that captures transcription events.
- `src/components/LiveAvatarSession.tsx`: Updated session component with side-by-side video and transcript layout.

## How to Integrate

1.  **Backup your existing files**:
    - `apps/demo/src/liveavatar/context.tsx`
    - `apps/demo/src/components/LiveAvatarSession.tsx`

2.  **Copy the new files**:
    Copy the files from this folder to their corresponding locations in your project:

    ```bash
    cp transcript-feature/src/liveavatar/context.tsx apps/demo/src/liveavatar/context.tsx
    cp transcript-feature/src/components/LiveAvatarSession.tsx apps/demo/src/components/LiveAvatarSession.tsx
    ```

## Features

- **Real-time Transcription**: Listens to `USER_TRANSCRIPTION` and `AVATAR_TRANSCRIPTION` events.
- **Side-by-Side Layout**: Displays the avatar video on the left and the conversation transcript on the right.
- **Auto-Scroll**: The transcript window automatically scrolls to the newest message.
- **Duplicate Prevention**: Includes cleanup logic to prevent double-logging of messages.
