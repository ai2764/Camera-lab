# LTX IA2V Prompt Notes

## 基础正向提示词模板

```text
A locked-off medium shot of the presenter speaking directly to camera in a warm cinematic classroom studio.
The presenter clearly speaks the exact line: "{line}".
Natural lip movement synchronized to the audio, subtle head movement, natural blinking, calm confident expression.
Keep the original face identity, outfit, pose, lighting, background layout, blackboard, desk props, and camera framing.
Stable background, stable blackboard, no camera zoom, no camera pan, no reframing.
No subtitles, no captions, no text overlay, no watermark.
```

## 今日好样本模板

`laodao_ltx_ia2v_external_audio_raw.mp4` 的 prompt 表现比多数实验稳定，可以作为下一轮默认模板：

```text
Locked-off medium-wide image-to-video shot using the provided first frame as the visual source. Lao Dao stays in the same position, gently blinks, moves his lips in sync with the input audio, makes one small natural pointer gesture toward the board, then settles back to stillness. Preserve the presenter identity, robe, glasses, classroom lighting, and original composition.
```

对应 negative：

```text
added subtitles, captions, closed captions, karaoke lyrics, title card, lower third, text overlay, new writing, new letters, extra Chinese characters, extra English words, changed sign, changed blackboard, warped readable text, logo, watermark, camera zoom, camera push-in, crop, cropped head, duplicated person, distorted face, deformed hands, flicker, jitter
```

这个模板的重点不是“更生动”，而是把动作限制在 LTX 比较能控制的范围内：

- 固定镜头。
- 保持人物原位置。
- 只做眨眼、口型、小幅指板手势。
- 明确要求回到静止。
- 明确禁止新增文字、黑板变化和镜头推近。

## 好模板复跑后的修正

复跑 `tasks` 后发现：

- 正面/半正面中景黑板场景更适合这个模板，例如 LLM 段和 WAN 段。
- 侧身首帧会让人物转身或离开画面，即使加 `stay in the same position` 也不一定能压住。
- 多主体画面必须明确谁说话。小美场景如果只写 Lao Dao，模型会尝试移动老道；改成“小美在 CRT 屏幕里说话，老道只轻微反应”后更稳定。

TTS 段修正版 prompt：

```text
Locked-off medium-wide image-to-video shot using the provided first frame as the visual source. Lao Dao stays in the same right-side position beside the board for the entire clip. He remains fully visible in frame, gently blinks, moves his lips in sync with the input audio, and makes only a tiny natural pointer motion. Do not let him walk away, turn his back, drift off-screen, or move toward the center. Preserve the presenter identity, robe, glasses, classroom lighting, board, text, props, and original composition.
```

更有效的修正是先重绘首帧，把人物变成正面稳定中景。对应成功文件：

```text
C:\Users\AIBOX\dev\youtube-video-lab\tasks\其次，我选cosy voice 2 0.5b 做tts生成语音，生成速度快，显存占用少。\first_frame_tts_ideal.png
C:\Users\AIBOX\dev\youtube-video-lab\tasks\其次，我选cosy voice 2 0.5b 做tts生成语音，生成速度快，显存占用少。\ltx_good_template_ideal_frame_01.mp4
```

经验：当首帧姿态暗示“人物正在侧身、转身、走动”时，LTX 很容易沿着这个动作继续发展。把首帧改成正面站稳后，同一套模板就明显更稳定。

嘴不动时，还需要让首帧本身带有“正在讲话”的视觉信号：

- 嘴微张，而不是完全闭嘴。
- 脸部略大，嘴部不要太小。
- 下颌、嘴唇、胡子边界清楚。
- prompt 写清楚 `lips separate and close`, `lower jaw moves`, `mouth opening changes with each phrase`。

中景强口型 prompt：

```text
Locked-off medium-wide image-to-video shot using the provided first frame as the exact visual source. Keep the same 16:9 composition, blackboard, board text, desk props, shelves, lanterns, and camera distance for the entire clip. Lao Dao stays on the right side of the blackboard, fully visible from about waist up, facing the camera in a stable three-quarter front pose. He speaks the input audio with clearly visible lip articulation: lips separate and close, lower jaw moves naturally, mouth opening changes with each phrase, and teeth are briefly visible when natural. Add only small natural head motion and blinking. Keep the pointer gesture small and stable. No camera zoom, no push-in, no close-up, no reframing, no crop change, no subtitles, no captions, no lower-third text, no new writing, no changed blackboard text.
```

注意：强口型 prompt 可能让 LTX 生成伪字幕或推近镜头。如果嘴动了但底部有伪字幕，可以用干净首帧的底部区域覆盖，保留脸部和口型。

小美场景修正版 prompt：

```text
Locked-off image-to-video shot using the provided first frame as the visual source. Keep the CRT monitor, Xiaomei's face on the screen, Lao Dao leaning beside it, desk, lamp, books, and warm classroom lighting in the same composition. Xiaomei on the monitor gently smiles and speaks in sync with the input audio, with natural lip movement and subtle facial expression. Lao Dao only makes a tiny natural reaction and stays in the same leaning position. No camera zoom, no reframing, no new people, no screen deformation, no extra text.
```

## 反向提示词模板

```text
subtitles, captions, text overlay, watermark, logo, random letters, fake writing, moving blackboard text,
camera zoom, push in, dolly in, pan, tilt, crop change, reframing,
deformed mouth, closed mouth, frozen lips, unsynchronized lips,
extra people, duplicated person, face morphing, identity change,
blur, flicker, jitter, distorted hands, broken glasses
```

## 中文口播注意点

- 尽量把台词显式写进 prompt，但不要指望 prompt 修正 TTS 或原生 A/V 的读音。
- 技术词可在 TTS 阶段处理读音，而不是交给视频模型。
- 对原生 A/V，复杂中文词容易读错，后期修复困难。

## 稳定画面经验

- 明确写 `locked-off camera`、`no camera zoom`、`stable background`。
- 如果黑板文字重要，尽量不要让视频模型直接维护整块黑板。
- 更稳的方案是：动态人物视频 + RMBG 抠像 + 静态背景板。

## Storyboard 方向

LTX 可以尝试用首帧、尾帧、多关键帧来控制视觉走势，但这更像“关键帧约束”，不是完整理解导演分镜。

适合测试：

- 第一帧：人物站定，看镜头。
- 中间帧：手势或表情变化。
- 尾帧：回到稳定站姿。

目标不是让模型一次生成长片，而是让每个 4-6 秒短段落更稳定。
