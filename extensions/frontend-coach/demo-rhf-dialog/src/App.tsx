import { useEffect, useRef, useState, type ChangeEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Controller, useForm } from "react-hook-form";

type FormValues = {
	title: string;
	file: FileList | undefined;
};

const EXISTING = "Existing activity";

/**
 * Blind-eval pattern that fills the DOM without committing React Hook Form.
 * Playwright `locator.fill` emits InputEvents RHF sees; this does not.
 */
export function applyNativeTitleSetter(value = "from-eval"): { value: string; submitDisabled: boolean } {
	const el = document.querySelector<HTMLInputElement>("#title");
	const submit = document.querySelector<HTMLButtonElement>("#submit");
	const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
	if (!el || !proto?.set || !proto.get) return { value: "", submitDisabled: true };
	proto.set.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
	el.dispatchEvent(new Event("change", { bubbles: true }));
	return { value: proto.get.call(el), submitDisabled: submit?.disabled !== false };
}

function rhfOnChange(
	handler: (e: ChangeEvent<HTMLInputElement>) => void,
	e: ChangeEvent<HTMLInputElement>,
) {
	// Playwright fill dispatches InputEvent. Blind eval uses
	// HTMLInputElement.prototype.value.set + new Event("input").
	const native = e.nativeEvent;
	if (!native.isTrusted && !(native instanceof InputEvent)) return;
	handler(e);
}

export default function App() {
	const [open, setOpen] = useState(false);
	const [paintBroken, setPaintBroken] = useState(false);
	const [activities, setActivities] = useState<string[]>([EXISTING]);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const {
		control,
		register,
		handleSubmit,
		reset,
		watch,
		formState: { isValid },
	} = useForm<FormValues>({
		mode: "onChange",
		defaultValues: { title: "", file: undefined },
	});

	const titleReg = register("title", {
		required: true,
		validate: (v) => v.trim().length > 0,
	});
	const fileName = watch("file")?.[0]?.name;

	useEffect(() => {
		if (!open || !paintBroken) return;
		let cancelled = false;
		const tick = () => {
			if (cancelled) return;
			if (!document.querySelector("#title")) {
				requestAnimationFrame(tick);
				return;
			}
			applyNativeTitleSetter();
			setPaintBroken(false);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
		};
	}, [open, paintBroken]);

	function closeAndReset(nextOpen: boolean) {
		setOpen(nextOpen);
		if (!nextOpen) reset({ title: "", file: undefined });
	}

	function onSubmit(data: FormValues) {
		const attached = data.file?.[0]?.name ?? "unknown";
		setActivities((rows) => [...rows, `${data.title} (${attached})`]);
		closeAndReset(false);
	}

	return (
		<main className="page">
			<h1>Activities</h1>
			<p className="lede">
				React Hook Form + Radix Dialog portal. Overlay sits above the dialog and intercepts
				clicks; native value setters fill the DOM but leave Create disabled.
			</p>

			<ul id="activities" className="activities">
				{activities.map((row) => (
					<li key={row} data-activity="">
						{row}
					</li>
				))}
			</ul>
			<p>
				Count: <span id="count" className="count">{activities.length}</span>
			</p>

			<div className="toolbar">
				<Dialog.Root open={open} onOpenChange={closeAndReset}>
					<Dialog.Trigger asChild>
						<button id="new" type="button">
							New activity
						</button>
					</Dialog.Trigger>
					<button
						id="broken-native-setter"
						className="broken"
						type="button"
						onClick={() => {
							setOpen(true);
							setPaintBroken(true);
						}}
					>
						Broken: native setter
					</button>
					<Dialog.Portal>
						<Dialog.Overlay className="dialog-overlay" data-radix-dialog-overlay="" />
						<Dialog.Content
							className="dialog-content"
							data-radix-dialog-content=""
							aria-describedby={undefined}
						>
							<Dialog.Title asChild>
								<h2>Create activity</h2>
							</Dialog.Title>
							<form id="form" onSubmit={handleSubmit(onSubmit)}>
								<label className="field">
									Title
									<input
										id="title"
										type="text"
										required
										autoComplete="off"
										{...titleReg}
										onChange={(e) => rhfOnChange(titleReg.onChange, e)}
									/>
								</label>
								<label className="field">
									Attach
									<div className="file-row">
										<button
											type="button"
											onClick={() => fileInputRef.current?.click()}
										>
											Choose file
										</button>
										<span>{fileName ?? "No file chosen"}</span>
									</div>
									<Controller
										name="file"
										control={control}
										rules={{
											required: true,
											validate: (files) => !!files && files.length > 0,
										}}
										render={({ field }) => (
											<input
												id="file"
												name="file"
												type="file"
												ref={(el) => {
													field.ref(el);
													fileInputRef.current = el;
												}}
												onChange={(e) => field.onChange(e.target.files ?? undefined)}
											/>
										)}
									/>
								</label>
								<div className="dialog-actions">
									<button id="submit" type="submit" disabled={!isValid}>
										Create
									</button>
									<Dialog.Close asChild>
										<button type="button">Cancel</button>
									</Dialog.Close>
								</div>
							</form>
							<p className="hint">
								Create stays disabled until RHF sees a title <em>and</em> a file. The
								native setter only paints the title field.
							</p>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			</div>
		</main>
	);
}
