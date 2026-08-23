export default function CategorySelect({
    formatOption = option => option.name,
    id,
    label,
    name,
    onChange,
    options,
    required = false,
    value
}) {
    return (
        <div className="form-row">
            <div className="form-group col-12 col-lg-5">
                <div className="input-group">
                    <div className="input-group-prepend">
                        <label className="input-group-text" htmlFor={id}>{label}</label>
                    </div>
                    <select
                        className="form-control"
                        id={id}
                        name={name}
                        value={value ?? ""}
                        required={required}
                        onChange={onChange}
                    >
                        <option value=""></option>
                        {options.map(option => (
                            <option key={option.id} value={option.id}>{formatOption(option)}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
