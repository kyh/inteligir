"use client";

import { reactivateUserInput } from "@inteligir/api/admin/admin-schema";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@inteligir/ui/alert-dialog";
import { Button } from "@inteligir/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@inteligir/ui/form";
import { Input } from "@inteligir/ui/input";
import { toast } from "@inteligir/ui/toast";

import { api } from "@/trpc/react";

export const AdminReactivateUserDialog = (
  props: React.PropsWithChildren<{
    userId: string;
  }>,
) => {
  const reactivateUserAction = api.admin.reactivateUser.useMutation({
    onSuccess: () => {
      toast.success("User reactivated successfully");
    },
    onError: () => {
      toast.error("There was an error. Please try again later.");
    },
  });
  const form = useForm({
    schema: reactivateUserInput,
    defaultValues: {
      userId: props.userId,
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{props.children}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reactivate User</AlertDialogTitle>

          <AlertDialogDescription>
            Are you sure you want to reactivate this user?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col space-y-8"
            onSubmit={form.handleSubmit((data) => {
              return reactivateUserAction.mutate(data);
            })}
          >
            <FormField
              name="confirmation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Type <b>CONFIRM</b> to confirm
                  </FormLabel>

                  <FormControl>
                    <Input
                      required
                      pattern="CONFIRM"
                      placeholder="Type CONFIRM to confirm"
                      {...field}
                    />
                  </FormControl>

                  <FormDescription>
                    Are you sure you want to do this?
                  </FormDescription>

                  <FormMessage />
                </FormItem>
              )}
            />

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>

              <Button type="submit">Reactivate User</Button>
            </AlertDialogFooter>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
