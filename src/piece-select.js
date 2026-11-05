/**
 * Themed replacement for a native <select>.
 * Renders a combobox button plus a listbox that follows the current theme.
 */
export class PieceSelect {
  constructor({ root, trigger, valueEl, menu, initial = 12, onChange }) {
    this.root = root;
    this.trigger = trigger;
    this.valueEl = valueEl;
    this.menu = menu;
    this.onChange = onChange;

    this.options = Array.from(menu.querySelectorAll('[role="option"]'));
    this.options.forEach((option, index) => {
      if (!option.id) option.id = `piece-option-${index}`;
    });

    this.value = initial;
    this.activeIndex = Math.max(
      0,
      this.options.findIndex((option) => Number(option.dataset.value) === initial)
    );
    this.open = false;

    this.trigger.addEventListener("click", () => this.toggle());
    this.trigger.addEventListener("keydown", (event) => this.onKeyDown(event));

    this.menu.addEventListener("click", (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      const index = this.options.indexOf(option);
      if (index !== -1) this.select(index);
    });

    document.addEventListener("pointerdown", (event) => {
      if (this.open && !this.root.contains(event.target)) this.close();
    });

    this.render();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.menu.hidden = false;
    this.root.classList.add("open");
    this.trigger.setAttribute("aria-expanded", "true");

    const selected = this.options.findIndex(
      (option) => option.getAttribute("aria-selected") === "true"
    );
    if (selected !== -1) this.activeIndex = selected;

    this.updateActive();
    this.scrollActiveIntoView();
  }

  close() {
    this.open = false;
    this.menu.hidden = true;
    this.root.classList.remove("open");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.removeAttribute("aria-activedescendant");
  }

  select(index, fire = true) {
    const option = this.options[index];
    if (!option) return;

    const value = Number(option.dataset.value);
    const changed = value !== this.value;

    this.value = value;
    this.activeIndex = index;
    this.options.forEach((item, i) =>
      item.setAttribute("aria-selected", String(i === index))
    );
    this.valueEl.textContent = String(value);

    this.close();
    this.trigger.focus({ preventScroll: true });

    if (changed && fire) this.onChange(value);
  }

  move(delta) {
    if (!this.options.length) return;
    this.activeIndex =
      (this.activeIndex + delta + this.options.length) % this.options.length;
    this.updateActive();
    this.scrollActiveIntoView();
  }

  setValue(value, fire = true) {
    const index = this.options.findIndex(
      (option) => Number(option.dataset.value) === value
    );
    if (index === -1) return;
    this.select(index, fire);
  }

  updateActive() {
    this.options.forEach((option, index) => {
      option.classList.toggle("active", index === this.activeIndex);
    });
    const active = this.options[this.activeIndex];
    if (active) this.trigger.setAttribute("aria-activedescendant", active.id);
  }

  scrollActiveIntoView() {
    const active = this.options[this.activeIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  onKeyDown(event) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!this.open) this.show();
        else this.move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!this.open) this.show();
        else this.move(-1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (this.open) this.select(this.activeIndex);
        else this.show();
        break;
      case "Escape":
        if (this.open) {
          event.preventDefault();
          this.close();
        }
        break;
      case "Tab":
        this.close();
        break;
      case "Home":
        if (this.open) {
          event.preventDefault();
          this.activeIndex = 0;
          this.updateActive();
          this.scrollActiveIntoView();
        }
        break;
      case "End":
        if (this.open) {
          event.preventDefault();
          this.activeIndex = this.options.length - 1;
          this.updateActive();
          this.scrollActiveIntoView();
        }
        break;
    }
  }

  render() {
    this.options.forEach((option, index) => {
      option.setAttribute(
        "aria-selected",
        String(Number(option.dataset.value) === this.value)
      );
      option.classList.toggle("active", index === this.activeIndex);
    });
    this.valueEl.textContent = String(this.value);
  }
}
