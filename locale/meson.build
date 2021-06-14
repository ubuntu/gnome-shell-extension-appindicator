gettext_domain = run_command(jq, '-r', '."gettext-domain"', metadata).stdout().strip()

i18n.gettext(gettext_domain,
    preset: 'glib',
    install_dir: locale_dir)
