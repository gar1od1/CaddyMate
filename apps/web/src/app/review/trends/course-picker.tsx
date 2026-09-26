'use client';

import { useRouter } from 'next/navigation';
import { Select, type SelectOption } from '@/components/primitives/Select';

/** Chooses the course for the Course view; the choice lives in the URL (`?course=`). */
export function CoursePicker({
  options,
  value,
  query,
}: {
  options: SelectOption[];
  value: string;
  /** The page's other parameters, kept when the course changes. */
  query: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label="Course"
      className="full-sm min-w-[16rem]"
      options={options}
      value={value}
      onChange={(course) =>
        router.push(`/review/trends?${new URLSearchParams({ ...query, course }).toString()}`, {
          scroll: false,
        })
      }
    />
  );
}
