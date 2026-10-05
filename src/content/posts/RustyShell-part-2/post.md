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

This allows me to directly access this field in the [runtime_resolve.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/runtime_resolve.rs), without having to do a cast at the moment I retrieve the data behind this field. You can find the redefinitions of this structure in the [peb_types.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/peb_types.rs) module.

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
    let bindings_content = read_to_string("src/winapi_bindings.rs").expect("Error: Couldn't read bindings file");
    let filtered_bindings = bindings_content.lines().filter(|line| !line.contains('{') && !line.contains('}') && !line.contains("pub fn")).collect::<Vec<&str>>().join("\n");
    write("src/winapi_bindings.rs", filtered_bindings).expect("Error: Couldn't replace bindings content with filtered one");
}
```

Inside the **filters** function, we can simply add the name of the WINAPI we want to use inside our code. This generates two things inside the [winapi_bindings.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/winapi_bindings.rs): The function directly that you can simply use and a function pointer for that exact same function. The small piece of code at the end of the build script is here to remove the function definition, because we don't wan to use that directly, since it will induce imports in the final binary, thus breaking shellcode.

Here is the generated [winapi_bindings.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/winapi_bindings.rs):

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
let mut user32_address: *mut c_void = null_mut();
resolve_call_winapi!(
    kernel32,
    LoadLibraryA,
    user32_address,
    c"user32.dll".as_ptr().cast()
);
```

At first, you have to declare and initialize the variable into which you want to receive the return value of the WINAPI. Then, you can start to call the macro. Here is the argument list:

- **Module Name**: The first argument is the name of the module into which the WINAPI is exported. You have to put the name of the file, without the extension *.dll* which is automatically added inside the macro.

- **The WINAPI name**: The name of the WINAPI you want to use. You need to write it exactly as it is defined inside the *winapi_bindings.rs* module, because this argument will also be used to define the type of the function pointer retrieved.

- **The variable that will receive the return value**: Then, you put the variable you initialized earlier, that will receive the return value of the WINAPI call.

- **The arguments of the call**: Lastly, you simply put the argument lists, in the order they are define on the MSDN documentation, just like you would have put them inside a call to the function directly.

So this is how you can quickly resolve the module address and function address and call the WINAPI function.

### call_winapi!

This one, on the other hand, is useful if you already have a pointer to the right module and don't want to resolve it again. It can be used like this:

```rust
// Example calling MessageBoxA
let mut result_message_box: i32 = 0;
call_winapi!(
    user32_address,
    MessageBoxA,
    result_message_box,
    null_mut(),
    c"Hello World!".as_ptr().cast(),
    c"Example".as_ptr().cast(),
    0
);
```

This is exactly like the first macro, except that *user32_address* refers directly to a pointer to user32.dll that has already been resolved.

The code for these macros can be found in the [utils.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/utils.rs) module.

## Several compilation mode for easy debugging

For this repo, I used the cargo-make project that lets you define several commands to build different binaries for example. I made three different binaries:

- **windows_gnu_shellcode**: This one is a shellcode in release mode, with no debugging features enabled.

- **windows_gnu_shellcode_debug**: This one is a shellcode target with debugging info.

- **windows_gnu_debug_no_shellcode**: This one is not even a shellcode and uses debugging information.

For the last target, I added another entry file, which doesn't contain the specific entry point inside .text.entry section. It simply uses a main function and can contain std code. It's here only for testing purposes, when you want to easily test a part of the code without being bothered by shellcode complexity.

The other two are similar, only the **debug** feature is enabled on **windows_gnu_shellcode_debug**. This feature only have influence on the printf function, available in the [utils.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/utils.rs) module, which is gated behind the debug feature. This function simply loads msvcrt.dll and get the printf pointer inside it to call it directly.

## Conclusion

You can find the shellcode entry point in the [shellcode.rs](https://github.com/LostAquilae/RustyShell/blob/main/src/shellcode.rs) file. This example simply showcases what you can do with the template, like using Vec and Strings thanks to the Global Allocator. It also shows how to use macros to call MessageBoxA for the example.

At this point, you have a well designed template that lets you code in Rust as position independent code in a simple and easy way. You can also use a great part of the std, the core and alloc components at least.

But one problem remains: Trait object. They are used in some parts of the core and alloc crate, and they break shellcode compatibility, meaning we cannot use every part of these crates. We'll see in the third part of this blog how we can tackle this problem.

## Sources

[windows-sys](https://crates.io/crates/windows-sys)

[windows-bindgen](https://crates.io/crates/windows-bindgen)