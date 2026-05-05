import React from 'react';
import { Stepper } from './ui/Stepper';

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}

export function ServingStepper({ value, onChange, min = 1, max = 99, label }: Props) {
  return <Stepper value={value} onChange={onChange} min={min} max={max} unit={label} />;
}
