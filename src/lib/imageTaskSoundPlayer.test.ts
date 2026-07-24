import { afterEach, describe, expect, test } from "bun:test";
import { playImageTaskSound, stopImageTaskSoundPlayback } from "./imageTaskSoundPlayer";

type AudioListener = () => void;

class FakeAudio {
  static instances: FakeAudio[] = [];

  readonly src: string;
  preload = "";
  volume = 1;
  currentTime = 0;
  pauseCalls = 0;
  playCalls = 0;
  private listeners = new Map<string, AudioListener>();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  addEventListener(name: string, listener: AudioListener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name: string) {
    this.listeners.delete(name);
  }

  play() {
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
  }
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  stopImageTaskSoundPlayback();
  FakeAudio.instances = [];
  if (originalWindowDescriptor) Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

describe("image task sound player", () => {
  test("rapid replay stops the previous sample and starts a fresh one", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Audio: FakeAudio }
    });

    expect(playImageTaskSound("/api/image-task-sounds/sound-a/file", 20)).toBe(true);
    expect(playImageTaskSound("/api/image-task-sounds/sound-a/file", 80)).toBe(true);

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[0]?.playCalls).toBe(1);
    expect(FakeAudio.instances[0]?.pauseCalls).toBe(1);
    expect(FakeAudio.instances[0]?.currentTime).toBe(0);
    expect(FakeAudio.instances[1]?.playCalls).toBe(1);
    expect(FakeAudio.instances[1]?.src).toBe("/api/image-task-sounds/sound-a/file");
    expect(FakeAudio.instances[1]?.volume).toBe(0.8);
  });
});
