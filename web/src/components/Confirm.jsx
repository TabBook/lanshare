export default function Confirm({ title, detail, confirmLabel = '删除', onConfirm, onCancel }) {
  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="pop-in w-full max-w-xs rounded-2xl bg-surface p-5 shadow-xl dark:bg-surface-dark"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-medium">{title}</h3>
        {detail && <p className="mt-1 text-sm text-faint dark:text-faint-dark">{detail}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-faint transition hover:bg-sunken active:scale-95 dark:text-faint-dark dark:hover:bg-sunken-dark"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-clay-deep px-3 py-1.5 text-sm text-white transition hover:opacity-90 hover:shadow-md hover:shadow-clay-deep/30 active:scale-95"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
