"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type Props = ComponentPropsWithoutRef<"select">;
type Choice = {
  label: string;
  value: string;
  disabled: boolean;
  index: number;
};

/** The native select remains the form control; the listbox only changes its presentation. */
export default function Select({
  children,
  className = "",
  style,
  onChange,
  onInvalid,
  onFocus,
  ...props
}: Props) {
  const id = useId();
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({
    choices: [] as Choice[],
    value: "",
    label: "",
    disabled: !!props.disabled,
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState("");
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const typeahead = useRef({ text: "", time: 0 });

  const sync = useCallback(() => {
    const select = native.current;
    if (!select) return;
    const labels = Array.from(select.labels || [])
      .map((label) => {
        const copy = label.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll(".ui-select,select,input,textarea")
          .forEach((element) => element.remove());
        return copy.textContent?.trim() || "";
      })
      .join(" ");
    const next = {
      choices: Array.from(select.options).map((option, index) => ({
        label: option.label,
        value: option.value,
        disabled:
          option.disabled ||
          (option.parentElement instanceof HTMLOptGroupElement &&
            option.parentElement.disabled),
        index,
      })),
      value: select.value,
      label:
        select.getAttribute("aria-label") ||
        labels ||
        select.title ||
        "Chọn giá trị",
      disabled: select.matches(":disabled"),
    };
    setState((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, []);

  // Includes changes to controlled values, asynchronous options and disabled fieldsets.
  useLayoutEffect(sync);
  useEffect(() => {
    const form = native.current?.form;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      setOpen(false);
      setInvalid("");
      timer = setTimeout(sync, 0);
    };
    form?.addEventListener("reset", reset);
    return () => {
      clearTimeout(timer);
      form?.removeEventListener("reset", reset);
    };
  }, [sync]);
  useEffect(() => {
    if (state.disabled) setOpen(false);
  }, [state.disabled]);

  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const popup = menu.current;
    if (typeof popup.showPopover === "function") popup.showPopover();
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0,
        topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth,
        height = viewport?.height || window.innerHeight;
      const below = topEdge + height - bounds.bottom - 8,
        above = bounds.top - topEdge - 8;
      const up = below < Math.min(popup.scrollHeight, 280) && above > below;
      const maxHeight = Math.min(280, Math.max(40, up ? above : below));
      const popupHeight = Math.min(popup.scrollHeight, maxHeight);
      const popupWidth = Math.min(Math.max(bounds.width, 180), width - 16);
      setPosition({
        visibility: "visible",
        fontFamily: getComputedStyle(trigger.current!).fontFamily,
        width: popupWidth,
        maxHeight,
        left: Math.max(
          leftEdge + 8,
          Math.min(bounds.left, leftEdge + width - popupWidth - 8),
        ),
        top: up
          ? Math.max(topEdge + 8, bounds.top - popupHeight - 6)
          : bounds.bottom + 6,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.parentElement?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!popup.contains(event.target as Node)) place();
    };
    place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      if (
        typeof popup.hidePopover === "function" &&
        popup.matches(":popover-open")
      )
        popup.hidePopover();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  useLayoutEffect(() => {
    const list = menu.current,
      item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, open]);

  const enabled = state.choices.filter((choice) => !choice.disabled);
  const show = () => {
    if (native.current?.matches(":disabled")) return;
    setActive(
      (enabled.find((choice) => choice.value === state.value) || enabled[0])
        ?.index ?? -1,
    );
    setPosition({ visibility: "hidden" });
    setOpen(true);
  };
  const choose = (index: number) => {
    const select = native.current;
    if (
      !select ||
      select.matches(":disabled") ||
      !state.choices[index] ||
      state.choices[index].disabled
    )
      return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setInvalid("");
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const selected = state.choices.find((choice) => choice.value === state.value);

  return (
    <span
      className={"ui-select " + className}
      style={style}
      data-disabled={state.disabled || undefined}
    >
      <select
        {...props}
        className="ui-select-native"
        ref={native}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          sync();
          setInvalid("");
          onChange?.(event);
        }}
        onFocus={(event) => {
          trigger.current?.focus({ preventScroll: true });
          onFocus?.(event);
        }}
        onInvalid={(event) => {
          onInvalid?.(event);
          event.preventDefault();
          setInvalid(
            event.currentTarget.validity.valueMissing
              ? "Vui lòng chọn một giá trị."
              : event.currentTarget.validationMessage,
          );
          trigger.current?.focus();
        }}
      >
        {children}
      </select>
      <span
        ref={trigger}
        role="combobox"
        tabIndex={state.disabled ? -1 : 0}
        className="ui-select-trigger"
        aria-label={state.label}
        aria-labelledby={props["aria-labelledby"]}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && active >= 0 ? id + "-" + active : undefined
        }
        aria-disabled={state.disabled}
        aria-required={props.required}
        aria-invalid={!!invalid || props["aria-invalid"]}
        aria-describedby={invalid ? id + "-error" : props["aria-describedby"]}
        title={props.title || selected?.label}
        onClick={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
          if (open) setOpen(false);
          else show();
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (state.disabled) return;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            if (!open) {
              show();
              if (event.key === "Home" || event.key === "End")
                setActive(
                  (event.key === "Home" ? enabled[0] : enabled.at(-1))?.index ??
                    -1,
                );
            } else {
              const current = enabled.findIndex(
                (choice) => choice.index === active,
              );
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? enabled.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          enabled.length - 1,
                          current + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      );
              setActive(enabled[index]?.index ?? -1);
            }
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            if (open) choose(active);
            else show();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
          else if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            event.preventDefault();
            const now = Date.now();
            typeahead.current = {
              text:
                (now - typeahead.current.time < 700
                  ? typeahead.current.text
                  : "") + event.key.toLocaleLowerCase("vi"),
              time: now,
            };
            const match = enabled.find((choice) =>
              choice.label
                .toLocaleLowerCase("vi")
                .startsWith(typeahead.current.text),
            );
            if (match) {
              if (open) setActive(match.index);
              else choose(match.index);
            }
          }
        }}
      >
        <span>{selected?.label || "\u00a0"}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </span>
      {invalid && (
        <span className="ui-select-error" id={id + "-error"} role="alert">
          {invalid}
        </span>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            popover="manual"
            role="listbox"
            aria-label={state.label}
            className="ui-select-menu"
            style={position}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {state.choices.map((choice) => (
              <div
                key={choice.index}
                id={id + "-" + choice.index}
                role="option"
                data-index={choice.index}
                aria-selected={choice.value === state.value}
                aria-disabled={choice.disabled}
                className={active === choice.index ? "is-active" : undefined}
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse" && !choice.disabled)
                    setActive(choice.index);
                }}
                onClick={() => choose(choice.index)}
              >
                <span>{choice.label}</span>
                {choice.value === state.value && (
                  <Check size={15} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          native.current?.closest("dialog") || document.body,
        )}
    </span>
  );
}
