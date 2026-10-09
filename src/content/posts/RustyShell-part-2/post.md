Writing shellcode means writing code with a lot of constraints.

The simple fact that you cannot use any standard library already forces you to use OS API to do anything. Add to that the fact that you have to resolve dynamically these function pointers, and you need ten lines of code to do what would have taken only one usually.

So how do we make this easier?

## Using windows-sys crate for Windows structures

We can include the [windows-sys](https://crates.io/crates/windows-sys) crate that already includes a lot of structures definition in pure Rust. This is useful to not having to rewrite every structure definition by hand. It is always possible to rewrite our own implementation of a structure, because sometimes some fields are not quite represented, because Windows consider these fields as private fields that we should not use.

Let's take an example, the **LDR_DATA_TABLE_ENTRY**, which is the structure representing a loaded module in the current process, found in the doubly linked list of loaded module inside the **PEB**. The windows-sys crate is implementing this structure like this:

```rust
#[repr(C)]
pub struct LDR_DATA_TABLE_ENTRY {
    pub Reserved1: [*mut c_void; 2],
    pub InMemoryOrderLinks: LIST_ENTRY,
    pub Reserved2: [*mut c_void; 2],
    pub DllBase: *mut c_void,
    pub Reserved3: [*mut c_void; 2],
    pub FullDllName: UNICODE_STRING,
    pub Reserved4: [u8; 8],
    pub Reserved5: [*mut c_void; 3],
    pub Anonymous: LDR_DATA_TABLE_ENTRY_0,
    pub TimeDateStamp: u32,
}
```

We see here that, following *FullDllName* is a field named *Reserved4*, and is composed of 8 bytes. But it is commonly known that this field is the *BaseDllName*, which is only the module filename, without the full path. That's why I redefined this structure to replace this *Reserved4* field into *BaseDllName* as a **UNICODE_STRING**, because it is the actual type behind this field.

This allows me to directly access this field in the [runtime_resolve.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/runtime_resolve.rs), without having to do a cast at the moment I retrieve the data behind this field. You can find the redefinitions of this structure in the [peb_types.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/peb_types.rs) module.

Apart from that, I can just include every structure I need from this crate directly, which is a great way to get pure Rust definitions of Windows structures.

## Using windows-bindgen crate for WINAPI function types

The [windows-bindgen](https://crates.io/crates/windows-bindgen) crate allows to automatically generate bindings for Windows structures and functions. The goal here is to automatically retrieve function pointers for the Windows API. We just need to add a [build.rs](https://github.com/LostAquilae/RustyShell/blob/main/build.rs) script:

```rust
use std::fs::{read_to_string, write};

fn main() {
    // Using windows bindgen to generate bindings for WINAPI we use
    windows_bindgen::Bindgen::new()
    .output("src/winapi_bindings.rs")
    .flat()
    .sys()
    .filters([
        "LoadLibraryA",
        "MessageBoxA"
        ]
    )
    .extern_fns()
    .write();

    // The windows bindgen crate generates 2 things for a WINAPI:
    // - The direct function you can call directly into your code
    // - The function pointer type that can be used as a function pointer
    //
    // Only the latter is of interest for us, since we are resolving WINAPI calls dynamically at runtime for shellcode purposes.
    // This small code only keep the type definitions and remove the functions

    // Reading the generated bindings from file into a String
    let bindings_content =
        read_to_string("src/winapi_bindings.rs").expect("Error: Couldn't read bindings file");

    // Applying a regular expression to it to remove the function definitions
    let regex = Regex::new(r#"unsafe extern "system" \{[^}]*\}"#)
        .expect("Couldn't construct regex object from regex string");
    let filtered_bindings = regex.replace_all(&bindings_content, "").to_string();

    // Overwriting the winapi_bindings.rs content with the new filtered one
    write("src/winapi_bindings.rs", filtered_bindings)
        .expect("Error: Couldn't replace bindings content with filtered one");
}
```

Inside the **filters** function, we can simply add the name of the WINAPI we want to use inside our code. This generates two things inside the [winapi_bindings.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/Shellcode_example/src/winapi_bindings.rs): The function directly that you can simply use and a function pointer for that exact same function. The small piece of code at the end of the build script is here to remove the function definition, because we don't want to use that directly, since it will induce imports in the final binary, thus breaking shellcode.

Here is the generated winapi bindings:

```rust
pub type LoadLibraryA = unsafe extern "system" fn(lplibfilename: PCSTR) -> HMODULE;

pub type MessageBoxA =
    unsafe extern "system" fn(hwnd: HWND, lptext: PCSTR, lpcaption: PCSTR, utype: u32) -> i32;

pub type HINSTANCE = *mut core::ffi::c_void;
pub type HMODULE = HINSTANCE;
pub type HWND = *mut core::ffi::c_void;
pub type PCSTR = *const u8;
```

We can see the two function pointers at the start. We can simply use these anywhere we need to cast a function pointer to call the corresponding function. Is also defines the types used inside the function pointer definition.

## Macros to make dynamically calling WINAPI function easier

I added two macros to the template : **resolve_call_winapi!** and **call_winapi!**. Let's explore how each one can be used.

### Resolve_call_winapi!

It can be used to automatically resolve the module address and the function address and call the function directly. Here's an example on how to use it for LoadLibraryA:

```rust
// Calling LoadLibraryA to load user32.dll in memory
let user32_address = resolve_call_winapi!(
    kernel32,
    LoadLibraryA,
    c"user32.dll".as_ptr().cast()
);
```

At first, you have to declare and initialize the variable into which you want to receive the return value of the WINAPI. Then, you can start to call the macro. Here is the argument list:

- **Module Name**: The first argument is the name of the module into which the WINAPI is exported. You have to put the name of the file, without the extension *.dll* which is automatically added inside the macro.

- **The WINAPI name**: The name of the WINAPI you want to use. You need to write it exactly as it is defined inside the *winapi_bindings.rs* module, because this argument will also be used to define the type of the function pointer retrieved.

- **The arguments of the call**: Lastly, you simply put the argument lists, in the order they are defined on the MSDN documentation, just like you would have put them inside a call to the function directly.

So this is how you can quickly resolve the module address and function address and call the WINAPI function.

### call_winapi!

This one, on the other hand, is useful if you already have a pointer to the right module and don't want to resolve it again. It can be used like this:

```rust
// Example calling MessageBoxA
let result_message_box = call_winapi!(
    user32_address,
    MessageBoxA,
    null_mut(),
    c"Hello World!".as_ptr().cast(),
    c"Example".as_ptr().cast(),
    0
);
```

This is exactly like the first macro, except that *user32_address* refers directly to a pointer to user32.dll that has already been resolved.

These macros return a Result with the Ok variant being the return value of the **WINAPI** you called and the Err variant being a RuntimeResolveErrors of the [runtime_resolve.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/runtime_resolve.rs) module.

The code for these macros can be found in the [utils.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/utils.rs) module.

## Several compilation mode for easy debugging

The repo contains three different crates:

- **rusty_shell**: This is the actual RustyShell crate, containing [allocator.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/allocator.rs) module, the [runtime_resolve.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/runtime_resolve.rs) module and the [utils.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/utils.rs) module, that you can depend on to automatically enable all this to use in your project.

- **shellcode_example**: This crate showcases how you can depend on rusty_shell to create your own shellcode crate. It shows you an example of entry point for shellcode and how you can use features of the rusty_shell crate.

- **no_shellcode_example**: This crate actually depends on the rusty_shell crate but not compiling as shellcode, for debug purposes mainly. It allows you to use the full std, and enables printing with println! inside the [runtime_resolve.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/runtime_resolve.rs) module, since this is the only way to print inside this module.

The rusty_shell crate comes with two features:

- **shellcode**: this is basically to gate every std related code behind this feature not being enabled. Again, the println! inside **runtime_resolve.rs** are gated behind it. This is a default feature.

- **debug**: This enables the printf! macro. In **utils.rs**, you can also find a printf! macro, which is gated behind the debug feature. This macro allows you to pass a literal string or a formatted string, thanks to the format! macro, to print something to the console.

I used the cargo make project to compile the different binaries. Here they are:

- **cargo make windows_gnu_shellcode**: Compiles the shellcode_example as shellcode, without **debug** feature enabled.

- **cargo make windows_gnu_shellcode_debug**: Compiles the shellcode_example as shellcode, with **debug** feature enabled, enabling printing through printf! macro.

- **cargo make windows_gnu_debug_no_shellcode**: Compiles the no_shellcode_example crate, allowing you to get prints inside the **runtime_resolve.rs** module.

So as you can see, the repo offers a lot of different way to compile the code, mostly for debug purposes.

## Conclusion

You can find the shellcode entry point in the [shellcode.rs](https://github.com/LostAquilae/RustyShell/blob/main/crates/Shellcode_example/src/shellcode.rs) file. This example simply showcases what you can do with the template, like using Vec and Strings thanks to the Global Allocator. It also shows how to use macros to call MessageBoxA for the example.

At this point, you have a well-designed template that lets you code in Rust as position-independent code in a simple and easy way. You can also use a great part of the std, the core and alloc components at least.

But one problem remains: Trait object. They are used in some parts of the core and alloc crate, and they break shellcode compatibility, meaning we cannot use every part of these crates. We'll see in the third part of this blog how we can tackle this problem.

## Sources

[windows-sys](https://crates.io/crates/windows-sys)

[windows-bindgen](https://crates.io/crates/windows-bindgen)