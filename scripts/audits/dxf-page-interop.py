"""Original page configurations, checked with an independent DXF implementation."""
import json
import sys
import ezdxf

ATTRIBUTES = ['page_setup_name', 'plot_configuration_file', 'paper_size', 'plot_view_name', 'left_margin', 'bottom_margin', 'right_margin', 'top_margin', 'paper_width', 'paper_height', 'plot_origin_x_offset', 'plot_origin_y_offset', 'plot_window_x1', 'plot_window_y1', 'plot_window_x2', 'plot_window_y2', 'scale_numerator', 'scale_denominator', 'plot_layout_flags', 'plot_paper_units', 'plot_rotation', 'plot_type', 'current_style_sheet', 'standard_scale_type', 'shade_plot_mode', 'shade_plot_resolution_level', 'shade_plot_custom_dpi', 'unit_factor', 'paper_image_origin_x', 'paper_image_origin_y']
action, path = sys.argv[1:]
if action == 'generate':
    doc = ezdxf.new('R2018')
    doc.layouts.new('Empty original')
    for index, layout in enumerate(doc.layouts):
        values = ['Preset ' + str(index), '', 'Original media ' + str(index), '', 11, 12, 13, 14, 610 + index, 914 + index, -2, 3, -20, -30, 125, 250, 2, 75, 132, index % 3, index % 4, 4, 'original.ctb', 25, 2, 5, 720, 1 / 25.4, 3.5, -4.5]
        layout.dxf_layout.dxf.update(dict(zip(ATTRIBUTES, values)))
    doc.layouts.get('Layout1').add_line((1, 2), (3, 4))
    doc.saveas(path)
elif action != 'inspect':
    raise ValueError('Unknown action')
doc = ezdxf.readfile(path)
audit = doc.audit()
assert not audit.errors and not audit.fixes
print(json.dumps({'version': ezdxf.__version__, 'layouts': {layout.name: {key: layout.dxf_layout.dxf.get(key, '') for key in ATTRIBUTES} for layout in doc.layouts}, 'counts': {layout.name: len(layout) for layout in doc.layouts}}))
