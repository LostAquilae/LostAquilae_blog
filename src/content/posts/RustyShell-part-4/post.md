I come back with another part for this RustyShell project, and this time it's about compile time string encryption. I recently added this feature to the project, and it unveiled some flaws inside my LLVM Pass logic to make vtables relative.

But first, let's see what compile time encryption for strings is.

## What is compile time encryption ?

Compile time encryption is the process of encrypting every literal strings in your binary during compilation so that they can not be read in your binary. You include a decryption logic in your binary that will decrypt every string at runtime before your code uses their value. The goal here is to prevent static analysis of our binary to reveal important information about it. Before that, since we are resolving WINAPI functions at runtime, we had the name of the WINAPI we were using as plain literal strings hardcoded inside our binary. This reveals a lot of what your code is actually doing, for example if we see 'CreateFileA' string inside your binary, we can safely assume that you are opening or creating a file, which is already a significant piece of information.

Of course this works only for static analysis. Dynamic analysis, on the other hand, can still see the WINAPI functions actually being called, along with the arguments used to call them. So compile time string encryption is here to prevent quick detection of our binary based on static analysis.

Rust provides procedural macros that are exactly the feature we need to integrate smoothly this process inside our compilation workflow. Procedural macros are specific macros in rust where you can take rust source code at compile time and transform it to generate a new source code. The main difference with C macros is that you can execute real rust code at compile time, therefore you can implement a real logic to modify your source code, which is exactly what we are going to take advantages of.

## Implementing compile time encryption in a shellcode compatible way

When I started thinking about adding this feature, I thought that maybe we could use some crate to do the encryption for us. But remember, we are in a **no std** constraint environment, so we have to find some crate that implements encryption within a **no std** environment. And this is exactly what the [aes-gcm](https://crates.io/crates/aes-gcm) crate provides.

Now that we have a crate, it's time to implement procedural macros that will allow us to encrypt strings. Documentation and code can be found inside the [rusty_shell_obfuscation](https://crates.io/crates/rusty_shell_obfuscation) crate, and on [GitHub](https://github.com/LostAquilae/RustyShell/tree/main/crates/RustyShell_obfuscation).

### The goal for the user

I want the user to be able to say "I don't want this string to appear inside my binary, encrypt it". Therefore, it would be like a macro that takes a literal string and returns the decrypted version of this literal string. The goal is to have something like this:

```rust
let string: String = encrypt!("test_string");
```

I also want the user to be able to pass a C string literal. In Rust, string literal are not null terminated. It is a problem when you want to send a string as argument of a WINAPI call, because they expect null terminated strings. Therefore, Rust provides a syntax with **c"string"**, with the prepended **c** character specifying that you want a C string literal:

```rust
let string: CString = encrypt!(c"test_string");
```

And finally, we have some identifiers in resolve_call_winapi and call_winapi that are transformed into strings. Let's look at the implementation of the resolve_call_winapi macro:

```rust
#[macro_export]
macro_rules! resolve_call_winapi {
    ($module:ident, $winapi:ident $(, $args:expr)*) => {
        $crate::runtime_resolve::get_module_address(core::concat!(core::stringify!($module), ".dll")).and_then(|module_address| {
            $crate::runtime_resolve::get_exported_symbol(module_address, core::stringify!($winapi)).map(|winapi_address| {
                let winapi_func: crate::winapi_bindings::$winapi = unsafe { core::mem::transmute(winapi_address) };
                unsafe { winapi_func($($args,)*) }
            })
        })
    }
}
```

We see here that the module is stringified thanks to [stringify!](https://doc.rust-lang.org/std/macro.stringify.html) macro and **".dll"** is appended to it thanks to the [concat!](https://doc.rust-lang.org/std/macro.concat.html) macro. The winapi identifier is also passed into **stringify!**. The problem is that the result of these macros are string literals that also end up in the final binary, we have to find a way to encrypt these as well.

So let's take a look at the code for the encrypt! macro.

### encrypt!

Here is the full code of the encrypt macro:

```rust
#[proc_macro]
pub fn encrypt(stream: TokenStream) -> TokenStream {
    // Parse the string literal into a string
    let stream2: TokenStream2 = stream.into();

    // Parsing the inputs

    // This is first to test if the inputs is a literal, either a string literal or a C string literal
    let (string_to_encrypt, is_cstring) = if let Ok(lit) = parse2::<Lit>(stream2.clone()) {
        match lit {
            Lit::Str(lit_str) => (lit_str.value(), false),
            Lit::CStr(lit_cstr) => {
                match String::try_from(lit_cstr.value()) {
                    Ok(string) => {
                        (string, true)
                    }
                    Err(error) => return Error::new_spanned(
                    lit_cstr, format!("Couldn't convert this CStr into a String: {}", error)).to_compile_error().into(),
                }
            }
            _ => return Error::new_spanned(
                stream2, "Couldn't encrypt this string: Only string literals and C string literals are allowed").to_compile_error().into(),
        }
    // Here we check if the arguments are macro compiler builtins like concat!, env!, include!, include_str!, stringify!, and we eagerly evaluate them to use the result directly inside this macro
    } else if let Ok(macro_string) = parse2::<MacroString>(stream2.clone()) {
        match macro_string.eval() {
            Ok(string) => (string, false),
            Err(error) => {
                return Error::new_spanned(
                    stream2,
                    format!(
                        "Couldn't eagerly evaluate compiler builtin macro: {}",
                        error
                    ),
                )
                .to_compile_error()
                .into();
            }
        }
    } else {
        return Error::new_spanned(
            stream2,
            "The arguments were not a literal or compiler macro invocation",
        )
        .to_compile_error()
        .into();
    };

    // Setting up encryption
    let aes_key = &ENCRYPTION_KEY;
    let nonce = &ENCRYPTION_NONCE;
    let cypher = Aes256Gcm::new(&aes_key);

    // Encrypting the string
    let encrypted = match cypher.encrypt(nonce, string_to_encrypt.as_bytes()) {
        Ok(vec) => vec,
        Err(error) => {
            return Error::new_spanned(
                stream2,
                format!(
                    "Couldn't encrypt this string: {}, error: {}",
                    string_to_encrypt, error
                ),
            )
            .to_compile_error()
            .into();
        }
    };

    // Getting the Literal byte string of the encrypted version of the string to emit it inside the emitted code
    let literal_encrypted = Literal::byte_string(&encrypted);

    // Generating the code to emit
    // This is fine to call unsafe functions since this comes from literal strings
    let result = if is_cstring {
        // String literals must be utf-8 to compile, so from_utf8_unchecked should be safe
        quote! { unsafe { crate::obfuscation::CString::from_vec_unchecked(crate::obfuscation::decrypt(#literal_encrypted)) } }
    } else {
        // C String literals can't have interior null bytes to compile, so from_vec_unchecked should be safe
        quote! { unsafe { crate::obfuscation::String::from_utf8_unchecked(crate::obfuscation::decrypt(#literal_encrypted)) } }
    };

    result.into()
}
```

There is a lot to say here, so let's take a look at the compile time logic first.

#### Parsing of the arguments

First, we need to parse the arguments. The first **if let Ok** is here to match if the user sent a Literal. If the user sent a Literal, we take the stringified value of the Literal, whether it be a string literal or a C string literal. We also set the value of a boolean to detect a C string literal, for further use.

Thanks to the [macro-string](https://crates.io/crates/macro-string) crate, we are able to eagerly evaluate the **concat!** and **stringify!** macros. This is exactly what the second **if let Ok** does. There is a specific behavior for these macros, since they are built-in inside the rust compiler, the macro call inside these macros are eagerly evaluated. But that's not something you can normally do inside your own macros. And that's specifically what we need here, because we need to get the result of these macros to encrypt the resulting string.

But the **macro-string** crate allows us to parse correctly these macros and evaluate them directly here, so that we can use the resulting string.

#### String encryption

Then, we set up everything for encryption, retrieving the key and nonce, and then we use **aes-gcm** crate to encrypt the string. At the end, we have a Literal we can transform into rust source code.

#### Emitted code

At then end, we simply emit the rust source code that will replace the **encrypt!("test_string")** macro call:

- **#literal_encrypted**: The first thing is to emit the encrypted version of the string literal as a string literal.

- **Call to crate::obfuscation::decrypt**: The literal is then placed inside a call to a decrypt function later defined in the proc macro crate, that will decrypt this string literal.

- **Call to wrapper type construction**: The decrypt function returns a **Vec\<u8\>**. Based on what the user sent as argument (normal or C string literal), the decrypt call is wrapped around **String::from_utf8_unchecked** or **CString::from_vec_unchecked**, to yield a CString or a String containing the decrypted literal string. It is safe to call these unsafe functions since the string comes from C string literal or normal string literal, which has to be normally constructed (no null byte inside C string literal and utf-8 valid for string literal) to compile.


This concludes the **encrypt!** macro, the user is then able to encrypt its string, and we are now able to integrate it inside the **resolve_call_winapi!** and **call_winapi!** macros, thanks to eager evaluation of **concat!** and **stringify!** macros.

### encrypt_in_place!

At this point, I tried to replace every string with a call to this encrypt! macro, and it triggered an infinite loop inside the [allocator](https://github.com/LostAquilae/RustyShell/blob/main/crates/RustyShell/src/allocator.rs) module. Of course, using this macro allocates a String, which is a heap allocated type, therefore it calls recursively the allocator code, hence the infinite loop.

But **aes-gcm** provides a way to use its algorithm without heap allocation. With the [decrypt_in_place](https://docs.rs/aes-gcm/latest/aes_gcm/struct.AesGcm.html#method.decrypt_in_place) and [encrypt in place](https://docs.rs/aes-gcm/latest/aes_gcm/struct.AesGcm.html#method.encrypt_in_place), combined with the [ArrayVec](https://docs.rs/arrayvec/latest/arrayvec/struct.ArrayVec.html) type, we can construct strings that live on the stack and can be used for encryption/decryption.

That's why I constructed an **encrypt_in_place!** macro to return a stack allocated decrypted string.

The code is almost the same as the encrypt macro, let's just take a look at the emitted code, since this where the main differences reside:

```rust
let result = if is_cstring {
        quote! {
            {
                let mut buffer: rusty_shell_obfuscation::aes_gcm::aead::arrayvec::ArrayVec<u8, #len> = rusty_shell_obfuscation::aes_gcm::aead::arrayvec::ArrayVec::<u8, #len>::new();
                buffer.try_extend_from_slice(#literal_encrypted).unwrap();
                crate::obfuscation::decrypt_in_place(&mut buffer);

                // This is fine to call from_bytes_with_nul_unchecked since this string comes from a C literal string at compile time that must bbe a valid C string (no interior nul byte and a terminating null byte)
                crate::obfuscation::ArrayVecCStrWrapper::from(buffer)
            }
        }
    } else {
        quote! {
            {
                let mut buffer: rusty_shell_obfuscation::aes_gcm::aead::arrayvec::ArrayVec<u8, #len> = rusty_shell_obfuscation::aes_gcm::aead::arrayvec::ArrayVec::<u8, #len>::new();
                buffer.try_extend_from_slice(#literal_encrypted).unwrap();
                crate::obfuscation::decrypt_in_place(&mut buffer);

                // This is fine to call from_utf8_unchecked since this string comes from a literal string at compile time that must be utf-8 to compile
                crate::obfuscation::ArrayVecStrWrapper::from(buffer)
            }
        }
    };
```

Here we add a whole block expression where we define a new **ArrayVec**, which is a stack allocated structure. We put the literal string encrypted inside it, and we wrap this structure inside either a **ArrayVecCStrWrapper** or a **ArrayVecStrWrapper**, depending on if you sent a C string literal or a string literal. We'll see what these types are later in this blog.

### init_obfuscation!

This macro is here to set up everything needed for runtime decryption inside your crate. Let's see what it does exactly:

```rust
#[proc_macro]
pub fn init_obfuscation(_item: TokenStream) -> TokenStream {
    // Access both statics to initialize them
    let aes_key = &ENCRYPTION_KEY;
    let aes_nonce = &ENCRYPTION_NONCE;

    let result = quote! {
        // Emitting a module for obfuscation
        pub mod obfuscation {
            extern crate alloc;
            pub use alloc::{ffi::CString, string::String};
            use alloc::vec::Vec;
            use rusty_shell_obfuscation::aes_gcm::{aead::{Aead, Key, KeyInit, AeadInOut, arrayvec::ArrayVec, Buffer}, Aes256Gcm, Nonce};
            use rusty_shell_obfuscation::hybrid_array::sizes::U12;

            // Declaring encryption key and nonce as non mutable statics (end up in .rdata)
            static ENCRYPTION_KEY: [u8; 32] = [#(#aes_key),*];
            static ENCRYPTION_NONCE: [u8; 12] = [#(#aes_nonce),*];

            /// Struct that is thin wrapper around ArrayVec and that coerces automatically to &str thanks to the deref trait
            pub struct ArrayVecStrWrapper<const N: usize> {
                array_vec: ArrayVec<u8, N>
            }

            /// Implements Deref trait to automatically coerce to a &str
            impl<const N: usize> core::ops::Deref for ArrayVecStrWrapper<N> {
                type Target = core::primitive::str;

                fn deref(&self) -> &core::primitive::str {
                    // String literals must be utf-8 to compile, so from_utf8_unchecked should be safe
                    unsafe { core::str::from_utf8_unchecked(self.array_vec.as_slice())}
                }
            }

            /// Implements From to instantiate the type directly from an ArrayVec
            impl<const N: usize> From<ArrayVec<u8, N>> for ArrayVecStrWrapper<N> {
                fn from(array: ArrayVec<u8, N>) -> Self {
                    ArrayVecStrWrapper {
                        array_vec: array
                    }
                }
            }

            /// Struct that is thin wrapper around ArrayVec and that coerces automatically to &CStr thanks to the deref trait
            pub struct ArrayVecCStrWrapper<const N: usize> {
                array_vec: ArrayVec<u8, N>
            }

            /// Implements Deref trait to automatically coerce to a &CStr
            impl<const N: usize> core::ops::Deref for ArrayVecCStrWrapper<N> {
                type Target = core::ffi::CStr;

                fn deref(&self) -> &core::ffi::CStr {
                    // C String literals can't have interior null bytes to compile, so from_vec_unchecked should be safe
                    unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(self.array_vec.as_slice())}
                }
            }

            /// Implements From to instantiate the type directly from an ArrayVec
            impl<const N: usize> From<ArrayVec<u8, N>> for ArrayVecCStrWrapper<N> {
                fn from(array: ArrayVec<u8, N>) -> Self {
                    ArrayVecCStrWrapper {
                        array_vec: array
                    }
                }
            }

            // Declare decrypt function which yields a heap allocated String holding the decrypted version of encrypted string literal sent as argument
            pub fn decrypt(encrypted: &[u8]) -> Vec<u8> {
                let key: Key<Aes256Gcm> = ENCRYPTION_KEY.into();
                let nonce: Nonce::<U12> = ENCRYPTION_NONCE.into();
                let cypher = Aes256Gcm::new(&key);
                cypher.decrypt(&nonce, encrypted.as_ref()).unwrap()
            }

            // Declare decrypt_in_place function that takes a Buffer holding the encrypted string and decrypt it in place, without allocating anything
            pub fn decrypt_in_place(encrypted: &mut dyn Buffer) {
                let key: Key<Aes256Gcm> = ENCRYPTION_KEY.into();
                let nonce: Nonce::<U12> = ENCRYPTION_NONCE.into();
                let cypher = Aes256Gcm::new(&key);
                cypher.decrypt_in_place(&nonce, b"", encrypted).unwrap();
            }
        }

    };

    result.into()
}
```

#### Encryption globals

The first thing here is we retrieve the values **ENCRYPTION_KEY** and **ENCRYPTION_NONCE**:

```rust
let aes_key = &ENCRYPTION_KEY;
let aes_nonce = &ENCRYPTION_NONCE;
```

These are **static** variables defined at the root of this proc macro crate:

```rust
static ENCRYPTION_KEY: LazyLock<Key<Aes256Gcm>> = LazyLock::new(|| Key::<Aes256Gcm>::generate());
static ENCRYPTION_NONCE: LazyLock<Nonce<U12>> = LazyLock::new(|| Nonce::<U12>::generate());
```

These statics are compiled with the proc macro crate, so they won't end up in the binary, they are only used at compile time to encrypt the strings, or to emit the actual statics that are going to be included in the binary (explained right below).

Then, the macro emits a whole module called **obfuscation**. It will serve as a path for everything needed inside the code emitted by the **encrypt!** and **encrypt_in_place!** macros. The first thing inside this obfuscation module is the 2 statics **ENCRYPTION_KEY** and **ENCRYPTION_NONCE**:

```rust
static ENCRYPTION_KEY: [u8; 32] = [#(#aes_key),*];
static ENCRYPTION_NONCE: [u8; 12] = [#(#aes_nonce),*];
```

These statics are not mutable and are never mutated in the code, so they will end up in **.rdata** section. There is something to consider with Rust though: interior mutability.

The **mut** keyword allows you to modify the value of a type. But some type have what is called **interior mutability**. It means that, even though your variable is declared as **non-mutable**, some functions implemented on this type might allow it to modify parts of its data. That's why, when you see a **static** declared without **mut** keyword, it doesn't mean that the value of this static will never change, hence it could still end up in **.data** section.

But here the 2 static are non-mutable and have no interior mutability since they are simple array of **u8** values. Therefore, their value will never change, and they take, at compile time, the bytes of the **encryption key** and **encryption nonce**.

#### Custom wrapper types for automatic coerce

Then we have the 2 Wrapper types, **ArrayVecStrWrapper** and **ArrayVecCStrWrapper**:

```rust
/// Struct that is thin wrapper around ArrayVec and that coerces automatically to &str thanks to the deref trait
pub struct ArrayVecStrWrapper<const N: usize> {
    array_vec: ArrayVec<u8, N>
}

/// Implements Deref trait to automatically coerce to a &str
impl<const N: usize> core::ops::Deref for ArrayVecStrWrapper<N> {
    type Target = core::primitive::str;

    fn deref(&self) -> &core::primitive::str {
        // String literals must be utf-8 to compile, so from_utf8_unchecked should be safe
        unsafe { core::str::from_utf8_unchecked(self.array_vec.as_slice())}
    }
}

/// Implements From to instantiate the type directly from an ArrayVec
impl<const N: usize> From<ArrayVec<u8, N>> for ArrayVecStrWrapper<N> {
    fn from(array: ArrayVec<u8, N>) -> Self {
        ArrayVecStrWrapper {
            array_vec: array
        }
    }
}

/// Struct that is thin wrapper around ArrayVec and that coerces automatically to &CStr thanks to the deref trait
pub struct ArrayVecCStrWrapper<const N: usize> {
    array_vec: ArrayVec<u8, N>
}

/// Implements Deref trait to automatically coerce to a &CStr
impl<const N: usize> core::ops::Deref for ArrayVecCStrWrapper<N> {
    type Target = core::ffi::CStr;

    fn deref(&self) -> &core::ffi::CStr {
        // C String literals can't have interior null bytes to compile, so from_vec_unchecked should be safe
        unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(self.array_vec.as_slice())}
    }
}

/// Implements From to instantiate the type directly from an ArrayVec
impl<const N: usize> From<ArrayVec<u8, N>> for ArrayVecCStrWrapper<N> {
    fn from(array: ArrayVec<u8, N>) -> Self {
        ArrayVecCStrWrapper {
            array_vec: array
        }
    }
}
```

These are simple types for wrapper around the **ArrayVec** type. I implemented these types so that I could implement the **Deref** trait on them. This trait is the logic behind the **\*** operator, when dereferencing the type. And here I implemented this trait so that the **ArrayVecStrWrapper** is dereferenced to a **&str** and the **ArrayVecCStrWrapper** is dereferenced to **&CStr**.

I also implemented the **From\<ArrayVec\>** trait for both, so that you can instantiate them easily from an **ArrayVec** object.

The implementation of this **Deref** trait is what allows the user to do this:

```rust
let stack_string: &str = &encrypt_in_place("test_stack_string");
```

Here, the return value, which is an **ArrayVecStrWrapper**, is automatically coerced to a **&str** based on the type declared by the user. Important to note that the user should explicitly specify the type **&str** of its variable here so that the compiler coerce this automatically. Otherwise, the user would just end up with a **&ArrayVecStrWrapper**.

#### decrypt functions

Finally, you have the decryption functions that will be used to do runtime decryption. They are both pretty similar:

```rust
// Declare decrypt function which yields a heap allocated String holding the decrypted version of encrypted string literal sent as argument
pub fn decrypt(encrypted: &[u8]) -> Vec<u8> {
    let key: Key<Aes256Gcm> = ENCRYPTION_KEY.into();
    let nonce: Nonce::<U12> = ENCRYPTION_NONCE.into();
    let cypher = Aes256Gcm::new(&key);
    cypher.decrypt(&nonce, encrypted.as_ref()).unwrap()
}

// Declare decrypt_in_place function that takes a Buffer holding the encrypted string and decrypt it in place, without allocating anything
pub fn decrypt_in_place(encrypted: &mut dyn Buffer) {
    let key: Key<Aes256Gcm> = ENCRYPTION_KEY.into();
    let nonce: Nonce::<U12> = ENCRYPTION_NONCE.into();
    let cypher = Aes256Gcm::new(&key);
    cypher.decrypt_in_place(&nonce, b"", encrypted).unwrap();
}
```

The first one just takes a **slice** of **u8**. It generates the **key** and **nonce** from the static variables implemented above, and initiates the decryption algorithm. Then, it calls the decrypt function to return the decrypted version of the slice, as an owned **Vec\<u8\>**.

The second one simply takes anything that can coerce to a **Buffer** trait object. It initiates the decryption algorithm, and then calls **decrypt_in_place** function. It doesn't return anything since the resulted decrypted version of the string is directly written inside the **Buffer** trait object sent as argument.

### The Wrapper crate

All the code for these macros are inside a [rusty_shell_obfuscation_proc_macro](https://crates.io/crates/rusty_shell_obfuscation_proc_macro) crate. But the user should import another wrapper crate, [rusty_shell_obfuscation](https://crates.io/crates/rusty_shell_obfuscation), that exposes wrapper macros and, more importantly, an **obfuscation** feature, which configure the wrapper macros behavior. Here is the code inside this crate:

```rust
#![no_std]

// Reexport this crate so that users of this crate don't have to import it specifically
pub use aes_gcm;

// Reexport this crate so that users of this crate don't have to import it specifically
pub use hybrid_array;

pub use rusty_shell_obfuscation_proc_macro;

pub use rusty_shell_obfuscation_proc_macro::init_obfuscation;

/// Simple wrapper around the internal proc macro crate, that allows to be configured for encryption or not based on the obfuscation feature
#[cfg(feature = "obfuscation")]
#[macro_export]
macro_rules! encrypt {
    ($($tokentree:tt)*) => {
        rusty_shell_obfuscation::rusty_shell_obfuscation_proc_macro::encrypt!($($tokentree)*)
    };
}

/// Simple wrapper around the internal proc macro crate, that allows to be configured for encryption or not based on the obfuscation feature
#[cfg(not(feature = "obfuscation"))]
#[macro_export]
macro_rules! encrypt {
    ($($tokentree:tt)*) => {
        $($tokentree)*
    };
}

/// Simple wrapper around the internal proc macro crate, that allows to be configured for encryption or not based on the obfuscation feature
#[cfg(feature = "obfuscation")]
#[macro_export]
macro_rules! encrypt_in_place {
    ($($tokentree:tt)*) => {
        rusty_shell_obfuscation::rusty_shell_obfuscation_proc_macro::encrypt_in_place!($($tokentree)*)
    };
}

/// Simple wrapper around the internal proc macro crate, that allows to be configured for encryption or not based on the obfuscation feature
#[cfg(not(feature = "obfuscation"))]
#[macro_export]
macro_rules! encrypt_in_place {
    ($($tokentree:tt)*) => {
        $($tokentree)*
    };
}
```

You see that depending on the **obfuscation** feature being enabled, the macros either forward the call to the **proc_macro** crate to actually encrypt strings, or it does simply nothing. This allows the user to enable or disable the encryption on a single feature, while keeping the same code in its crate.

Also, this crate reexport **aes-gcm** and [hybrid-array](https://crates.io/crates/hybrid-array) crates, because they are used inside the **init_obfuscation!** macro, which end up in the user's crate. If this wasn't reexported, the user would have to explicitly import these crates while not having any visual usage of these, since it would be hidden behind the **init_obfuscation!** macro invocation. I wanted to avoid such requirement that would create potential non-intuitive compilation errors.

So here is everything we need to implement compile time string encryption. But the shellcode compatibility was not that easy to achieve. I stumbled upon different problems that I had to resolve.

## Mutable static inside aes-gcm dependencies

The first problem I discovered is that after compiling this proc macro crate inside my binary, I have now a **.data** section. Therefore, a global variable must reside inside **aes-gcm** code or its dependencies. Well, the culprit is the [cpufeatures](https://crates.io/crates/cpufeatures), which emits, inside its **new!** macro, a **static** variable.

But why is this dependency use inside the **aes-gcm** ? Well some processors in **x86** architecture provides some instructions to automatically executes some parts of the **AES** algorithm directly. It was designed to simplify and gather usage of **AES** algorithm under a unique, vulnerability-proof implementation.

But these instructions are not available on any processor your code might run on. The **cpufeatures** crate tries, at runtime, to detect if certain features are available on the current processor, among other the **AES-NI** instructions, for the **AES** algorithm. You can find the code [here](https://docs.rs/cpufeatures/latest/src/cpufeatures/lib.rs.html#35-109). We can clearly see these lines:

```rust
const UNINIT: u8 = u8::MAX;
static STORAGE: AtomicU8 = AtomicU8::new(UNINIT);
```

The **const** variable is not a problem, since every usage of a **const** variable in Rust will be copied everywhere it is used in the code, meaning no global variable will actually be emitted in the final binary. On the contrary, the **static STORAGE** here is not mutable, but the [AtomicU8](https://doc.rust-lang.org/core/sync/atomic/type.AtomicU8.html) has interior mutability, thanks to its [store](https://doc.rust-lang.org/core/sync/atomic/type.AtomicU8.html#method.store) function.

The **aes-gcm** crate can either use these instructions or it provides its own, fully software implementation. And it turns out, you can force it to use this software implementation, which removes the code that includes the **new!** macro of the cpufeatures, effectively removing the global variable that was generating a **.data** section.

The same thing is happening for the [polyval](https://crates.io/crates/polyval) crate. It tries to detect if some instruction is available on the current processor thanks to the **cpufeatures**.

That's why, we have these two new compilation flags:

- **--cfg aes_backend=\"soft\"**: forces the **aes-gcm** crate to use its software backend, bypassing the **cpufeatures** completely.

- **--cfg polyval_backend=\"soft\"**: forces the **polyval** crate to use its software backend, bypassing the **cpufeatures** completely.

## Rust Supertrait's vtable emission

The other problem I encountered is Rust emission of Supertrait's vtable. But first, what is a Supertrait ?

### What's a Supertrait

In Rust, you have a feature called [Supertraits](https://doc.rust-lang.org/rust-by-example/trait/supertraits.html). It allows you to define some trait as being a **subtrait** of another trait. Therefore, when implementing the subtrait on one of your type, you are required to implement the supertrait as well.

And each trait might have its own vtable in case of usage of trait object. Let's see how this vtables are emitted, and what is their ABI.

### Vtables of Supertrait in LLVM IR

Here is the LLVM generated for a Supertrait:

```rust
@alloc_e65b770e2f1786a69b5eeed7243191ca = private unnamed_addr constant <{ ptr, [16 x i8], ptr }> <{ ptr @_RINvNtCs62EBvuLm7Bv_4core3ptr9drop_glueINtNtCsaoI728x3TpW_5alloc3vec3VechEECs1QICqzgo7EA_11rusty_shell, [16 x i8] c"\18\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXsu_NtCsaoI728x3TpW_5alloc3vecINtB5_3VechEINtNtCs62EBvuLm7Bv_4core7convert5AsRefShE6as_refCs1QICqzgo7EA_11rusty_shell }>, align 8, !guid !47
@vtable.0.688 = private unnamed_addr constant { ptr, [16 x i8], ptr } { ptr @_RINvNtCs62EBvuLm7Bv_4core3ptr9drop_glueINtNtCsaoI728x3TpW_5alloc3vec3VechEECs1QICqzgo7EA_11rusty_shell, [16 x i8] c"\18\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @alloc_e65b770e2f1786a69b5eeed7243191ca, ptr @_RNvYINtNtCsaoI728x3TpW_5alloc3vec3VechENtCs9utC988nDTu_4aead6Buffer3lenCs1QICqzgo7EA_11rusty_shell }, align 8, !guid !48
```

The first **@alloc_e65b770e2f1786a69b5eeed7243191ca**, even though its name doesn't start with **@vtable**, is a vtable of some Supertrait. Then, the **@vtable.0.688** is a vtable of some subtrait of **@alloc_e65b770e2f1786a69b5eeed7243191ca**. We can see that, because one of its field is actually a pointer to the first vtable. And that's how Supertrait vtables work in Rust, they are actually included inside the vtables of their subtraits.

Therefore, there were 2 problems with my LLVM Pass script:

### Vtables recognition

In my LLVM Pass, the logic to detect a vtable was purely based on the global name starting with **@vtable**. But, for some reason, Supertrait's vtable do not follow this naming convention. Therefore, I implemented a logic to detect vtables based on their layout. The following rules are checked:

- **First field**: The first field of the vtable is either a function pointer or directly a [24 x i8] array, if the drop function is null.

- **Second field**: Based on the first field, it's either a [16 x i8] array, or a pointer. It can be a function pointer for a trait method or a global pointer for a supertrait vtable.

- **Remaining fields**: All the remaining field are checked to see if they are indeed pointers.

Based on that, we can recognize any vtable using its layout.

### Load Instruction on vtables access

The other logic that was broken is actually the fix on vtable access. My previous logic was to catch every call instruction that is actually a call inside a vtable. I managed to identify these because they were the only ones to have both **inlinehint** and **nounwind** call attributes.

Then, from these call instructions, I was moving back up to the **load ptr** and **getelementptr** instruction to fix them. But the access to a Supertrait's vtable is now not directly related to a call instruction. So this logic would miss these.

When I was working on this logic, I managed to see that, on almost every **load** instruction related to vtables, the **!invariant.load** metadata was present. Only one **load** was missing it, that's why I decided to not use this as a marker for vtables access.

But then I found out this **!invariant.load** is actually inserted by the Rust compiler on every vtable call, and more importantly, only on these loads. Therefore, it should be present on every **load** regarding vtable access. You can find the code about this [here](https://github.com/rust-lang/rust/blob/a94dce0bbb3aab81bfdcc30e8a55d7dc95bc644d/compiler/rustc_codegen_ssa/src/meth.rs#L19) Apparently some other passes might remove this metadata, hence the **load** I observed that was missing it.

Therefore, I had an idea: I just need to execute before this Pass that might delete **!invariant.load** metadata. That's why I modify the registration point of my LLVM Pass. Before I used this function:

```cpp
PB.registerPipelineParsingCallback(
    [](StringRef Name, ModulePassManager &MPM, ArrayRef<PassBuilder::PipelineElement>)
    {
        if (Name == "relative-vtable")
        {
            MPM.addPass(PCRelativeVtable());
            return true;
        }
        return false;
    });
```

And I had to use **-C passes=relative-vtable** to specifically request that my pass executes, which registered my pass after lots of other Passes had run, especially the one that would drop **!invariant.load** metadata on some **load** instruction about vtables.

Now I use this function:

```cpp
PB.registerPipelineStartEPCallback(
    [](ModulePassManager &MPM, OptimizationLevel Level)
    {
        MPM.addPass(PCRelativeVtable());
    });
```

**registerPipelineStartEPCallback** function register the LLVM Pass at the very start of the whole pipeline, therefore, we can see all the **!invariant.load** metadata on every **load** instruction inside vtables. We can remove the **-C passes=relative-vtable** flag, since now, our Pass will be run without it, at the very start of the LLVM Pass pipeline.

## Conclusion

Implementing compile time string encryption was actually rather simple. Thanks to the **aes-gcm** crate, we can directly use the **AES** algorithm. Thanks to **procedural macro**, we can simply integrate this in the compilation workflow. Some minor configuration was required to remove any unwanted code. I was kind of lucky there, because this configuration might not have been there, which would have prevented me from using this crate entirely.

It also allowed me to learn more about Rust LLVM IR emission, especially on Supertrait's vtable. That's why I was able to adapt my LLVM Pass logic to handle this new use case. Thank you for reading this post, I hope you found it interesting and learned something along the way.

## Sources

[aes-gcm crate for AES encryption](https://crates.io/crates/aes-gcm)

[stringify!](https://doc.rust-lang.org/std/macro.stringify.html) and [concat!](https://doc.rust-lang.org/std/macro.concat.html) macros

[macro-string crate for eager evaluation of built-ins macros](https://crates.io/crates/macro-string)

[arrayvec for ArrayVec stack allocated type](https://docs.rs/arrayvec/latest/arrayvec/struct.ArrayVec.html)

[cpufeatures crate](https://crates.io/crates/cpufeatures)

[AtomicU8 type](https://doc.rust-lang.org/core/sync/atomic/type.AtomicU8.html)

[Supertraits](https://doc.rust-lang.org/rust-by-example/trait/supertraits.html)

[Rust compiler source about !invariant.load metadata](https://github.com/rust-lang/rust/blob/a94dce0bbb3aab81bfdcc30e8a55d7dc95bc644d/compiler/rustc_codegen_ssa/src/meth.rs#L19)