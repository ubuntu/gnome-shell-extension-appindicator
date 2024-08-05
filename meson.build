project('gnome-shell-ubuntu-appindicators',
  version : '59',
  meson_version : '>= 0.53',
  license: 'GPL2',
)

gnome = import ('gnome')
i18n = import('i18n')

if get_option('local_install').auto()
    local_install = false
    if get_option('prefix') == '/usr/local'
        local_install = run_command(find_program('id'), '-u').stdout().strip() != '0'
    endif
else
    local_install = get_option('local_install').enabled()
endif

sh = find_program('sh')
jq = find_program('jq')
metadata = files('metadata.json')
uuid = run_command(jq, '-r', '.uuid', metadata).stdout().strip()

if local_install
    prefix = run_command(sh, '-c', 'echo $HOME').stdout().strip() / '.local'
else
    prefix = get_option('prefix')
endif

extension_dir = prefix / 'share' / 'gnome-shell' / 'extensions' / uuid

if local_install
    locale_dir = extension_dir / 'locale'
    schema_dir = extension_dir / 'schemas'
else
    locale_dir = prefix / get_option('localedir')
    schema_dir = prefix / get_option('datadir') / 'glib-2.0' / 'schemas'
endif

ls_cmd = ' '.join(['ls', '-1', '@0@'])
js_sources = run_command(sh, '-c', ls_cmd.format('*.js')).stdout().strip().split('\n')
install_data(metadata,
    files(js_sources),
    install_dir: extension_dir)
install_subdir('interfaces-xml',
    install_dir: extension_dir)

subdir('schemas')
subdir('locale')


eslint = find_program('eslint', required: false)
if eslint.found()
    test('eslint',
        eslint,
        args: [meson.project_source_root(), '-f', 'tap'],
        workdir: meson.source_root(),
        protocol: 'tap')
endif

if local_install
    run_target('zip-file',
        command: [
            sh, '-c',
            ';'.join([
                'set -xe',
                'tmp_path="$(mktemp -d)"',
                'trap "rm -rf $tmp_path" EXIT INT',
                'zip_file="$MESON_BUILD_ROOT/@0@.zip"'.format(uuid),
                'env DESTDIR="$tmp_path" ninja -C $MESON_BUILD_ROOT install',
                'cd "$tmp_path/@0@"'.format(extension_dir),
                'rm -f "$zip_file"',
                'zip -r "$zip_file" .',
            ])
        ])
endif

summary({
    'Local installation': local_install,
    'Extension UUID': uuid,
    'Gettext domain': gettext_domain,
    'ESLint': eslint.found(),
    },
    section: 'Configuration')

summary({
    'Extension directory': extension_dir,
    'GSchema directory': schema_dir,
    'Locale directory': locale_dir,
    },
    section: 'Directories')
