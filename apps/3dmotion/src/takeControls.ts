type RecordTakeControlInput = {
  isRecordingTake: boolean;
  isExporting: boolean;
};

type RecordTakeControl = {
  icon: 'video' | 'square';
  label: string;
  disabled: boolean;
};

export function getRecordTakeControl({ isRecordingTake, isExporting }: RecordTakeControlInput): RecordTakeControl {
  if (isExporting) {
    return {
      icon: 'square',
      label: 'Rendering',
      disabled: true,
    };
  }

  if (isRecordingTake) {
    return {
      icon: 'square',
      label: 'Stop & Render',
      disabled: false,
    };
  }

  return {
    icon: 'video',
    label: 'Record Take',
    disabled: false,
  };
}
