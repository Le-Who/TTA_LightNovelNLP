# TTA LightNovelNLP (Voice Library)

A sophisticated React application for exploring AI voices, generating character-specific system prompts, and converting novel chapters into full-cast audio dramas using Google's Gemini API.

## 🌟 Features

### 1. Voice Library Explorer

- **3D Carousel & Grid Views**: Interactive visualization of available voice models.
- **Filtering**: Filter voices by gender, pitch, and characteristics.
- **Audio Previews**: Instant playback of voice samples.

### 2. AI Casting Director (`VoiceFinder`)

- **Natural Language Search**: Describe a character (e.g., "A grumpy old wizard with a raspy voice") and finding the closest matches.
- **Prompt Generation**: Automatically generates a detailed `System Instruction` and sample text for the selected voice, ready for use in LLM personas.

### 3. Story Mode (Audio Drama Generator)

- **Novel-to-Speech**: Paste a full novel chapter.
- **Automatic Analysis**: Identifies the Narrator and all distinct characters.
- **Smart Casting**: Algorithmically assigns the best available voice to each character based on gender, age, and personality traits described in the text.
- **Concurrent Generation**: Generates audio for multiple segments in parallel using a worker-like pattern to speed up processing.
- **Rate Limit Handling**: Robust handling of API quotas with automatic key rotation and exponential backoff.

## 🛠 Tech Stack

- **Frontend Framework**: React 19 + Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS + Lucide Icons
- **AI Integration**: Google GenAI SDK (`@google/genai`) - Direct client-side calls.
- **Audio**: Web Audio API (for concatenation, analysis, and visualization).

## 🚀 Installation & Setup

### Prerequisites

- Node.js (v18+)
- Google Gemini API Key(s)

### Setup

1.  **Clone the repository**

    ```bash
    git clone https://github.com/your-repo/tta-lightnovelnlp.git
    cd tta-lightnovelnlp
    ```

2.  **Install Dependencies**

    ```bash
    npm install
    ```

3.  **Environment Configuration**
    Create a `.env` file in the root directory. You can provide multiple API keys separated by commas to increase throughput and handle rate limits.

    ```env
    # Single Key
    VITE_EXT_API_KEY=your_gemini_api_key_here

    # OR Multiple Keys (Recommended for Story Mode)
    VITE_EXT_API_KEY=key1,key2,key3
    ```

    _(Note: The application uses a custom `KeyManager` to parse and rotate these keys)._

4.  **Run Development Server**
    ```bash
    npm run dev
    ```

## 🏗 Architecture & Mental Map

The application is a client-side SPA that interacts directly with the Gemini API. It does not require a backend server for the core logic, as all orchestration happens in the browser.

### Core Data Flow

1.  **Static Data**: Voice definitions are loaded from `constants.ts`.
2.  **State Management**: React `useState` and `useMemo` handle UI state.
3.  **Audio Processing**: `audioUtils.ts` handles Base64 decoding and merging of audio buffers.

### Key Components

#### `components/VoiceFinder.tsx` (AI Casting)

- **Input**: User natural language query.
- **Process**: Sends `VOICE_DATA` + `Query` to Gemini Flash.
- **Output**: Returns top 3 voice matches + custom System Instruction.

#### `components/StoryMode.tsx` (Story Generator)

This is the most complex component, implementing a multi-stage pipeline:

1.  **Text Analysis**: Uses Gemini to parse the chapter into a script loop: `[Speaker, Text]`.
2.  **Optimization**: Merges short consecutive lines by the same speaker to reduce API calls.
3.  **Smart Casting**: Calculates a compatibility score between Character Profiles and Voice Metadata (Gender, Pitch, Tags).
4.  **Generation Loop**:
    - Iterates through the script.
    - Manages a concurrency limit (e.g., 3 requests in parallel).
    - Calls `KeyManager` to get a working API key.
    - Handles `429 Too Many Requests` by jailing keys and retrying.
5.  **Audio Stitching**: Uses `AudioContext` to concatenate all segment buffers into a single WAV blob.

#### `utils/keyManager.ts`

- **Purpose**: specific utility to handle Google API rate limits.
- **Mechanism**: Round-robin selection with "Jail" functionality. If a key hits a rate limit, it is "jailed" for 60 seconds, and the manager automatically switches to the next available key.

## 📂 Project Structure

```
/
├── components/          # React UI Components
│   ├── VoiceFinder.tsx  # AI Casting Logic
│   ├── StoryMode.tsx    # Audio Drama Generator
│   ├── Carousel3D.tsx   # 3D Voice Selection UI
│   └── ...
├── utils/
│   ├── audioUtils.ts    # Wav decoding & concatenation
│   ├── keyManager.ts    # API Key rotation logic
│   └── logger.ts        # Session logging
├── constants.ts         # Hardcoded Voice Data & Metadata
├── App.tsx              # Main Entry Point
└── package.json
```

## ⚠️ Known Limitations

- **Browser Memory**: Extremely long chapters ("Story Mode") may consume significant memory due to holding uncompressed AudioBuffers.
- **API Costs**: Heavy use of "Story Mode" consumes many output tokens/audio seconds.
