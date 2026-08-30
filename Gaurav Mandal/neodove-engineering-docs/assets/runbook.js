(function () {
  "use strict";

  function shellQuote(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
  }

  function renderValue(input) {
    var value = input.value;
    if (input.dataset.transform === "upper") return value.toUpperCase();
    return value;
  }

  function utcStamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function inputDefaultValue(input) {
    if (input.dataset.stampUtc === "true") return utcStamp();
    return input.defaultValue;
  }

  function collectFormValues() {
    var values = {};
    document.querySelectorAll(".runbook-form [data-var]").forEach(function (input) {
      values[input.dataset.var] = renderValue(input);
    });
    if (values.RUNBOOK_DB && values.RUNBOOK_BACKUP_DIR && values.RUNBOOK_STAMP) {
      values.RUNBOOK_DUMP = values.RUNBOOK_BACKUP_DIR + "/" + values.RUNBOOK_DB + "_" + values.RUNBOOK_STAMP + ".dump";
      values.RUNBOOK_GLOBALS = values.RUNBOOK_BACKUP_DIR + "/cluster_globals_" + values.RUNBOOK_STAMP + ".sql";
      values.RUNBOOK_CHECKSUM = values.RUNBOOK_BACKUP_DIR + "/checksums_" + values.RUNBOOK_STAMP + ".sha256";
    }
    if (values.RUNBOOK_S3_BASE && values.RUNBOOK_DB && values.RUNBOOK_STAMP) {
      values.RUNBOOK_S3_PREFIX = values.RUNBOOK_S3_BASE + "/" + values.RUNBOOK_DB + "/" + values.RUNBOOK_STAMP + "/";
    }
    if (values.PITR_BUCKET && values.PITR_PREFIX && values.PITR_ENV) {
      values.PITR_ROOT_URI = "s3://" + values.PITR_BUCKET + "/" + values.PITR_PREFIX + "/" + values.PITR_ENV;
      values.PITR_BASE_URI = values.PITR_ROOT_URI + "/base";
      values.PITR_WAL_URI = values.PITR_ROOT_URI + "/wal";
    }
    return values;
  }

  function storageKey(form) {
    var label = form.getAttribute("aria-label") || "runbook";
    return "neodove-runbook:" + window.location.pathname + ":" + label;
  }

  function readStoredForm(form) {
    try {
      return JSON.parse(window.localStorage.getItem(storageKey(form)) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveStoredForm(form) {
    var values = {};
    form.querySelectorAll("[data-var]").forEach(function (input) {
      values[input.dataset.var] = input.value;
    });
    try {
      window.localStorage.setItem(storageKey(form), JSON.stringify(values));
    } catch (error) {
      return;
    }
  }

  function resetStoredForm(form) {
    try {
      window.localStorage.removeItem(storageKey(form));
    } catch (error) {
      /* Continue with visual reset even when storage is unavailable. */
    }
    form.querySelectorAll("[data-var]").forEach(function (input) {
      input.value = inputDefaultValue(input);
    });
  }

  function applyStoredForms() {
    document.querySelectorAll(".runbook-form").forEach(function (form) {
      var saved = readStoredForm(form);
      form.querySelectorAll("[data-var]").forEach(function (input) {
        if (Object.prototype.hasOwnProperty.call(saved, input.dataset.var)) {
          input.value = saved[input.dataset.var];
        } else if (input.dataset.stampUtc === "true") {
          input.value = utcStamp();
        }
      });
    });
  }

  function addFormActions() {
    document.querySelectorAll(".runbook-form").forEach(function (form) {
      if (form.querySelector(".runbook-form__actions")) return;

      var actions = document.createElement("div");
      actions.className = "runbook-form__actions";

      var note = document.createElement("span");
      note.textContent = "Saved in this browser. Reset clears this form.";

      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "reset-button";
      reset.textContent = "Reset form";
      reset.addEventListener("click", function () {
        resetStoredForm(form);
        renderTemplates();
      });

      actions.appendChild(note);
      actions.appendChild(reset);
      form.appendChild(actions);
    });
  }

  function expandShellVariables(text, values) {
    return text
      .replace(/\$\{(RUNBOOK_[A-Z0-9_]+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? shellQuote(values[name]) : match;
      })
      .replace(/\$(RUNBOOK_[A-Z0-9_]+)/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? shellQuote(values[name]) : match;
      });
  }

  function renderTextTemplate(text, values) {
    return expandShellVariables(
      text.replace(/\{\{([A-Z0-9_]+)\}\}/g, function (_, name) {
        return shellQuote(values[name] || "");
      }),
      values
    );
  }

  function renderTemplates() {
    var values = collectFormValues();
    document.querySelectorAll(".command code, p code").forEach(function (code) {
      if (!code.dataset.template) {
        code.dataset.template = code.textContent;
      }

      code.textContent = renderTextTemplate(code.dataset.template, values);
    });
  }

  function copyFallback(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed"));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return copyFallback(text);
  }

  applyStoredForms();
  addFormActions();

  document.querySelectorAll(".runbook-form input").forEach(function (input) {
    input.addEventListener("input", function () {
      var form = input.closest(".runbook-form");
      if (form) saveStoredForm(form);
      renderTemplates();
    });
  });

  renderTemplates();

  document.querySelectorAll(".command").forEach(function (block, index) {
    var code = block.querySelector("code");
    if (!code) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy command " + (index + 1));

    button.addEventListener("click", function () {
      copyText(code.textContent.replace(/\n$/, ""))
        .then(function () {
          button.textContent = "Copied";
          button.dataset.state = "copied";
          window.setTimeout(function () {
            button.textContent = "Copy";
            delete button.dataset.state;
          }, 1800);
        })
        .catch(function () {
          button.textContent = "Select text";
          code.parentElement.focus();
        });
    });

    block.appendChild(button);
  });
})();
