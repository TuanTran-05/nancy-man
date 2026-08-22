interface AssignmentTitleCardProps {
  title: string;
  description: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
}

export function AssignmentTitleCard({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: AssignmentTitleCardProps) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="mb-4 h-2 rounded-full bg-indigo-600" aria-hidden="true" />
      <label className="block">
        <span className="sr-only">Assignment title on canvas</span>
        <input
          aria-label="Assignment title on canvas"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Untitled advanced assignment"
          className="w-full border-0 border-b border-slate-200 bg-transparent px-0 pb-2 text-2xl font-black text-slate-950 outline-none focus:border-indigo-500"
        />
      </label>
      <label className="mt-3 block">
        <span className="sr-only">Assignment description</span>
        <textarea
          aria-label="Assignment description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={2}
          placeholder="Assignment description"
          className="w-full resize-none rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-200 focus:bg-white"
        />
      </label>
    </section>
  );
}
